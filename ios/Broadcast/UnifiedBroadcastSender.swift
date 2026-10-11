import Foundation
import ReplayKit
import WebRTC

// Friend/channel signaling adapter around the actual build54 capture engine.
final class UnifiedBroadcastSender: NSObject, RTCPeerConnectionDelegate {
    private final class Node {
        let uid: String
        let connection = UUID().uuidString.lowercased()
        var peer: RTCPeerConnection!
        var ready = false
        var candidates: [RTCIceCandidate] = []
        var offer: String?
        var seen = Date()
        var quality: [String: Any]?
        var stats: [String: Any] = [:]
        var statsPending = false
        var encoded: Int64 = 0
        var statsAt = 0.0
        init(_ uid: String) { self.uid = uid }
    }
    private let queue = DispatchQueue(label: "org.solaris.unified.broadcast")
    private let group: URL
    private let engine: BroadcastWebRTCSender
    private let network = URLSession(configuration: .ephemeral)
    private var context: [String: Any]
    private var nodes: [String: Node] = [:]
    private var timer: DispatchSourceTimer?
    private var cursor: Int64 = 0
    private var polling = false
    private var stopped = false
    private var refreshing = false
    private var lastTouch = Date.distantPast
    private var lastStats = Date.distantPast
    private let startedAt = Date()
    private let finish: (Error) -> Void
    init(context: [String: Any], group: URL, finish: @escaping (Error) -> Void) throws {
        guard let url = context["url"] as? String, URL(string: url)?.host?.hasSuffix(".supabase.co") == true,
              url.hasPrefix("https://"), let uid = context["uid"] as? String, UUID(uuidString: uid) != nil,
              let id = context["id"] as? String, UUID(uuidString: id) != nil,
              context["accessToken"] is String, context["refreshToken"] is String,
              let scope = context["scope"] as? [String: Any], ["direct", "channel"].contains(scope["kind"] as? String ?? ""),
              UUID(uuidString: scope["id"] as? String ?? "") != nil else { throw NSError(domain: "Solaris", code: 1, userInfo: [NSLocalizedDescriptionKey: "화면공유 설정 또는 인증이 유효하지 않습니다."]) }
        self.context = context; self.group = group; self.finish = finish
        engine = BroadcastWebRTCSender(config: P2PBroadcastConfig(projectURL: url,
            publishableKey: context["key"] as? String ?? "", roomID: id),
            directory: group, unifiedTransport: true)
        super.init()
    }
    private var id: String { context["id"] as! String }
    private var scope: [String: Any] { context["scope"] as! [String: Any] }
    func start() {
        queue.async {
            let t = DispatchSource.makeTimerSource(queue: self.queue)
            t.schedule(deadline: .now(), repeating: 1); t.setEventHandler { [weak self] in self?.poll() }; self.timer = t; t.resume()
        }
    }
    func stop() {
        queue.async { self.stopInternal() }
    }
    private func stopInternal() {
        guard !stopped else { return }; stopped = true; timer?.cancel(); timer = nil
        for n in nodes.values { n.peer.close() }; nodes.removeAll(); engine.stop(); diagnostics()
        rpc("broadcast_stop", ["id": id]) { _ in }
    }
    func captureApplicationAudio(_ sample: CMSampleBuffer) { engine.captureApplicationAudio(sample) }
    func capture(_ sample: CMSampleBuffer) {
        engine.capture(sample)
    }
    private func poll() {
        guard !stopped, !polling, !refreshing else { return }
        let captureReady = engine.unifiedFramesReady()
        if !captureReady && Date().timeIntervalSince(startedAt) > 10 {
            stopInternal()
            finish(NSError(domain: "Solaris", code: 3, userInfo: [NSLocalizedDescriptionKey: "ReplayKit 캡처 프레임이 도착하지 않았습니다. 화면공유를 다시 시작하세요."]))
            return
        }
        guard let data = try? Data(contentsOf: group.appendingPathComponent("unified-broadcast.json")),
              let latest = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], latest["id"] as? String == id else {
            stopInternal(); finish(NSError(domain: "Solaris", code: 2, userInfo: [NSLocalizedDescriptionKey: "Solaris에서 화면공유를 종료했습니다."])); return
        }
        if let exp = latest["expiresAt"] as? Double, exp > (context["expiresAt"] as? Double ?? 0) { context = latest }
        if (context["expiresAt"] as? Double ?? Date().timeIntervalSince1970 + 3600) < Date().timeIntervalSince1970 + 90 { refresh(); return }
        polling = true
        rpc("sync", ["cursor": cursor]) { [weak self] response in
            guard let self else { return }; self.polling = false; guard !self.stopped else { return }
            guard let snapshot = response as? [String: Any] else { return }
            guard (snapshot["broadcasts"] as? [[String: Any]] ?? []).contains(where: { $0["id"] as? String == self.id }) else { self.stopInternal(); return }
            self.prune(snapshot)
            for signal in snapshot["signals"] as? [[String: Any]] ?? [] {
                self.cursor = max(self.cursor, (signal["id"] as? NSNumber)?.int64Value ?? 0)
                guard let p = signal["payload"] as? [String: Any], p["broadcast"] as? String == self.id,
                      signal["scope_kind"] as? String == self.scope["kind"] as? String,
                      signal["scope_id"] as? String == self.scope["id"] as? String,
                      let sender = signal["sender"] as? String else { continue }
                self.handle(sender, p)
            }
            for (uid,n) in Array(self.nodes) where Date().timeIntervalSince(n.seen)>45 { n.peer.close(); self.nodes.removeValue(forKey: uid) }
        }
        if captureReady && Date().timeIntervalSince(lastTouch)>10 { lastTouch = Date(); rpc("broadcast_touch", ["id": id]) { _ in } }
        if Date().timeIntervalSince(lastStats)>2 {
            lastStats = Date()
            for node in nodes.values { sampleStats(node) }
            diagnostics()
        }
    }
    private func prune(_ snapshot: [String: Any]) {
        var allowed = Set<String>()
        if scope["kind"] as? String == "direct" {
            for s in snapshot["sessions"] as? [[String: Any]] ?? [] where s["id"] as? String == scope["id"] as? String && s["state"] as? String == "accepted" {
                if let a = s["a"] as? String { allowed.insert(a) }; if let b = s["b"] as? String { allowed.insert(b) }
            }
        } else {
            let server = (snapshot["channels"] as? [[String: Any]] ?? []).first(where: { $0["id"] as? String == scope["id"] as? String })?["server_id"] as? String
            if let server { for m in snapshot["members"] as? [[String: Any]] ?? [] where m["server_id"] as? String == server {
                if let uid = (m["profile"] as? [String: Any])?["uid"] as? String { allowed.insert(uid) }
            } }
        }
        for (uid, node) in Array(nodes) where !allowed.contains(uid) { node.peer.close(); nodes.removeValue(forKey: uid) }
    }
    private func handle(_ uid: String, _ p: [String: Any]) {
        let type = p["type"] as? String ?? ""
        if type == "media-join" || type == "media-recover" {
            if type == "media-recover", let n = nodes[uid] { guard p["connectionID"] as? String == n.connection else { return }; n.peer.close(); nodes.removeValue(forKey: uid) }
            if let n = nodes[uid], let offer = n.offer { n.seen = Date(); signal(n, ["type":"native-offer","sdp":offer]); return }
            guard nodes.count<5 else { return }; join(uid); return
        }
        guard let n = nodes[uid], p["connectionID"] as? String == n.connection else { return }; n.seen = Date()
        if type == "native-answer", let sdp = p["sdp"] as? String {
            n.peer.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { [weak self] error in self?.queue.async { guard let self, !self.stopped, self.nodes[uid] === n else { return }; if error == nil { n.ready = true; for c in n.candidates { n.peer.add(c) { _ in } }; n.candidates.removeAll(); self.policy(n) } } }
        } else if type == "native-ice", let c = p["candidate"] as? [String: Any], let sdp = c["candidate"] as? String {
            let value = RTCIceCandidate(sdp: sdp, sdpMLineIndex: (c["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0, sdpMid: c["sdpMid"] as? String)
            if n.ready { n.peer.add(value) { _ in } } else if n.candidates.count<128 { n.candidates.append(value) }
        } else if type == "media-leave" { n.peer.close(); nodes.removeValue(forKey: uid) }
        else if type == "media-quality", let q = p["quality"] as? [String: Any] { n.quality = q; policy(n) }
    }
    private func join(_ uid: String) {
        guard engine.unifiedFramesReady() else { return }
        let n = Node(uid), rtc = RTCConfiguration(); rtc.sdpSemantics = .unifiedPlan
        rtc.iceServers = (context["iceServers"] as? [[String: Any]] ?? []).compactMap { s in
            let urls = (s["urls"] as? [String]) ?? (s["urls"] as? String).map { [$0] } ?? []
            return urls.isEmpty ? nil : RTCIceServer(urlStrings: urls, username: s["username"] as? String, credential: s["credential"] as? String)
        }
        n.peer = engine.makeUnifiedPeer(configuration: rtc, delegate: self)
        guard n.peer != nil else { return }; nodes[uid] = n
        policy(n)
        n.peer.offer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { [weak self] description, error in
            guard let self, let description, error == nil else { return }
            self.queue.async {
                guard !self.stopped, self.nodes[uid] === n else { return }
                let tuned = RTCSessionDescription(type: .offer, sdp: self.engine.unifiedScreenSDP(description.sdp))
                n.peer.setLocalDescription(tuned) { error in self.queue.async {
                    guard !self.stopped, error == nil, self.nodes[uid] === n else { return }
                    n.offer = tuned.sdp; self.signal(n, ["type":"native-offer","sdp":tuned.sdp])
                } }
            }
        }
    }
    private func policy(_ n: Node) {
        engine.applyUnifiedPolicies(n.peer.senders)
    }
    private func signal(_ n: Node, _ payload: [String: Any]) {
        var p = payload; p["broadcast"] = id; p["connectionID"] = n.connection
        rpc("signal", ["recipient":n.uid,"scope_kind":scope["kind"]!,"scope_id":scope["id"]!,"payload":p]) { _ in }
    }
    private func rpc(_ action: String, _ args: [String: Any], _ completion: @escaping (Any?) -> Void) {
        guard let base = context["url"] as? String, let url = URL(string: base + "/rest/v1/rpc/solaris_action") else { completion(nil); return }
        var r = URLRequest(url: url); r.httpMethod = "POST"; r.timeoutInterval = 6; r.httpBody = try? JSONSerialization.data(withJSONObject: ["action":action,"args":args])
        r.setValue(context["key"] as? String, forHTTPHeaderField: "apikey"); r.setValue("Bearer \(context["accessToken"] as? String ?? "")", forHTTPHeaderField: "Authorization"); r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        network.dataTask(with: r) { [weak self] data,response,error in
            self?.queue.async { let ok = error == nil && (response as? HTTPURLResponse)?.statusCode == 200; completion(ok ? data.flatMap { try? JSONSerialization.jsonObject(with: $0, options: .fragmentsAllowed) } : nil) }
        }.resume()
    }
    private func refresh() {
        refreshing = true
        var r = URLRequest(url: URL(string: (context["url"] as! String) + "/auth/v1/token?grant_type=refresh_token")!); r.httpMethod="POST"; r.timeoutInterval=6
        r.setValue(context["key"] as? String,forHTTPHeaderField:"apikey"); r.setValue("application/json",forHTTPHeaderField:"Content-Type"); r.httpBody=try? JSONSerialization.data(withJSONObject:["refresh_token":context["refreshToken"]!])
        network.dataTask(with:r) { [weak self] data,response,error in self?.queue.async {
            guard let self else { return }; self.refreshing=false
            guard error == nil, (response as? HTTPURLResponse)?.statusCode == 200, let data, var s=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any], let token=s["access_token"] as? String, let refresh=s["refresh_token"] as? String, (s["user"] as? [String:Any])?["id"] as? String == self.context["uid"] as? String else { return }
            let expiry=(s["expires_at"] as? Double) ?? Date().timeIntervalSince1970+(s["expires_in"] as? Double ?? 3600); s["expires_at"]=expiry
            self.context["accessToken"]=token;self.context["refreshToken"]=refresh;self.context["expiresAt"]=expiry
            if let bytes=try? JSONSerialization.data(withJSONObject:self.context) { try? bytes.write(to:self.group.appendingPathComponent("unified-broadcast.json"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]) }
            if let bytes=try? JSONSerialization.data(withJSONObject:s) { try? bytes.write(to:self.group.appendingPathComponent("shared-session.json"),options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication]) }
        }}.resume()
    }
    private func sampleStats(_ node: Node) {
        guard !node.statsPending else { return }; node.statsPending = true
        node.peer.statistics { [weak self] report in
            self?.queue.async {
                guard let self, !self.stopped, self.nodes[node.uid] === node else { return }
                node.statsPending = false
                let now = ProcessInfo.processInfo.systemUptime, elapsed = now - node.statsAt
                var values: [String: Any] = [:]
                for stat in report.statistics.values where stat.type == "outbound-rtp" {
                    let v = stat.values
                    guard (v["kind"] as? String ?? v["mediaType"] as? String) == "video" else { continue }
                    let encoded = (v["framesEncoded"] as? NSNumber)?.int64Value ?? 0
                    values["encodedFPS"] = node.statsAt > 0 && elapsed > 0 ? Double(max(0, encoded - node.encoded)) / elapsed : 0
                    for key in ["frameWidth", "frameHeight", "framesEncoded", "totalEncodeTime", "encoderImplementation", "qualityLimitationReason"] { if let value = v[key] { values[key] = value } }
                    if let codecID = v["codecId"] as? String, let codec = report.statistics[codecID] { values["codec"] = codec.values["mimeType"] }
                    node.encoded = encoded
                }
                node.statsAt = now; node.stats = values; self.diagnostics()
            }
        }
    }
    private func diagnostics() {
        var d:[String:Any]=["id":id,"state":stopped ? "stopped" : "active","version":"0.4.0-build58","peers":nodes.count,"updatedAt":Date().timeIntervalSince1970]
        d["encoders"] = nodes.values.map { ["connectionID": $0.connection, "statistics": $0.stats] as [String: Any] }
        d.merge(engine.unifiedCaptureDiagnostics()) { _, new in new }
        d.merge(SolarisProcessMetrics.snapshot()) { _, new in new }
        if let data=try? JSONSerialization.data(withJSONObject:d) { try? data.write(to:group.appendingPathComponent("unified-diagnostics.json"),options:.atomic) }
    }
    func peerConnection(_ p: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        queue.async { guard !self.stopped, let n=self.nodes.values.first(where:{$0.peer===p}) else{return}; self.signal(n,["type":"native-ice","candidate":["candidate":candidate.sdp,"sdpMid":candidate.sdpMid ?? "0","sdpMLineIndex":candidate.sdpMLineIndex]]) }
    }
    func peerConnection(_ p: RTCPeerConnection,didChange state:RTCIceConnectionState){
        if state == .connected || state == .completed {
            queue.async { guard !self.stopped, let n = self.nodes.values.first(where: {$0.peer === p}) else { return }; self.policy(n) }
        }
    }
    func peerConnection(_ p: RTCPeerConnection,didChange state:RTCSignalingState){}
    func peerConnection(_ p: RTCPeerConnection,didAdd stream:RTCMediaStream){}
    func peerConnection(_ p: RTCPeerConnection,didRemove stream:RTCMediaStream){}
    func peerConnectionShouldNegotiate(_ p:RTCPeerConnection){}
    func peerConnection(_ p: RTCPeerConnection,didChange state:RTCIceGatheringState){}
    func peerConnection(_ p: RTCPeerConnection,didRemove candidates:[RTCIceCandidate]){}
    func peerConnection(_ p: RTCPeerConnection,didOpen channel:RTCDataChannel){channel.close()}
}
