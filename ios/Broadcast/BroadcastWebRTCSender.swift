import Foundation
import ReplayKit
import WebRTC

// All mutable state and peer operations are serialized on queue. Capture uses
// sync so no unbounded queue of retained ReplayKit pixel buffers can accumulate.
final class BroadcastWebRTCSender: NSObject {
    private let config: P2PBroadcastConfig
    private let directory: URL?
    private let queue = DispatchQueue(label: "org.solaris.probe.webrtc")
    private let factory: RTCPeerConnectionFactory
    private let source: RTCVideoSource
    private let capturer: RTCVideoCapturer
    private let quality: ScreenQuality
    private var videoTrack: RTCVideoTrack!
    private var peer: RTCPeerConnection!
    private var channel: RTCDataChannel?
    private var timer: DispatchSourceTimer?
    private var network: URLSession!
    private var diagnostics = BroadcastDiagnostics()
    private var stopped = false
    private var polling = false
    private var lastID: Int64 = 0
    private var sessionID: String?
    private var remoteReady = false
    private var pending: [RTCIceCandidate] = []
    private var lastFrame = 0.0
    private var lastWrite = 0.0
    private var lastSize = ""
    private var offerPublished = false
    private var localCandidates: [[String: Any]] = []
    private var fpsWindowStart = 0.0
    private var fpsWindowFrames = 0
    // Windows must start first; stale offers older than five minutes are ignored.
    private let earliestOffer = Date().addingTimeInterval(-300)

    init(config: P2PBroadcastConfig, directory: URL?) {
        self.config = config
        self.directory = directory
        self.quality = ScreenQuality.extensionCurrent()
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(),
                                           decoderFactory: RTCDefaultVideoDecoderFactory())
        source = factory.videoSource()
        capturer = RTCVideoCapturer(delegate: source)
        super.init()
        diagnostics.room = config.roomID
        diagnostics.qualityID = quality.id
        diagnostics.targetFPS = quality.fps
        let rtc = RTCConfiguration()
        rtc.sdpSemantics = .unifiedPlan
        rtc.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]),
                          RTCIceServer(urlStrings: ["stun:global.stun.twilio.com:3478"])]
        peer = factory.peerConnection(with: rtc,
            constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self)
        videoTrack = factory.videoTrack(with: source, trackId: "solaris-screen")
        videoTrack.isEnabled = true
        _ = peer.add(videoTrack, streamIds: ["solaris-screen-stream"])
        let settings = URLSessionConfiguration.ephemeral
        settings.timeoutIntervalForRequest = 6
        settings.timeoutIntervalForResource = 8
        settings.urlCache = nil
        settings.httpCookieStorage = nil
        network = URLSession(configuration: settings, delegate: ProbeLANDelegate(), delegateQueue: nil)
    }

    func start() {
        queue.async {
            guard !self.stopped, self.timer == nil else { return }
            self.note("Windows 화면 수신기의 offer 대기")
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now(), repeating: 1)
            timer.setEventHandler { [weak self] in
                self?.persist()
                self?.poll()
            }
            self.timer = timer
            timer.resume()
        }
    }

    func stop() {
        queue.sync {
            guard !stopped else { return }
            stopped = true
            timer?.cancel()
            timer = nil
            channel?.close()
            peer.close()
            network.invalidateAndCancel()
            note("방송 종료")
        }
    }

    func capture(_ sample: CMSampleBuffer) {
        queue.sync {
            guard !stopped, let pixel = CMSampleBufferGetImageBuffer(sample) else { return }
            let now = ProcessInfo.processInfo.systemUptime
            guard now - lastFrame >= 1.0 / Double(max(1, quality.fps)) else { return }
            lastFrame = now
            let width = CVPixelBufferGetWidth(pixel), height = CVPixelBufferGetHeight(pixel)
            diagnostics.sourceWidth = width
            diagnostics.sourceHeight = height
            diagnostics.sourceAspect = String(format: "%.4f", Double(width) / Double(max(1, height)))
            fpsWindowFrames += 1
            if fpsWindowStart == 0 { fpsWindowStart = now }
            if now - fpsWindowStart >= 1 {
                diagnostics.inputFPS = Double(fpsWindowFrames) / (now - fpsWindowStart)
                fpsWindowFrames = 0
                fpsWindowStart = now
            }
            let size = "\(width)x\(height)"
            let scale = min(1.0, Double(quality.maxLongSide) / Double(max(width, height)))
            let w = max(2, Int(Double(width) * scale) / 2 * 2)
            let h = max(2, Int(Double(height) * scale) / 2 * 2)
            // Re-assert the requested native-preserving format on every
            // submitted frame so an adaptive startup downscale does not
            // remain active for the rest of the broadcast.
            source.adaptOutputFormat(toWidth: Int32(w), height: Int32(h), fps: Int32(quality.fps))
            if size != lastSize {
                diagnostics.outputWidth = w
                diagnostics.outputHeight = h
                diagnostics.scaling = (w == width && h == height) ? "원본 유지" : "송출 축소"
                note("원본 (width)x(height) → 출력 (w)x(h), (quality.title)")
                lastSize = size
            }
            let seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
            guard seconds.isFinite, seconds >= 0, seconds < Double(Int64.max) / 1_000_000_000 else { return }
            let orientation = (CMGetAttachment(sample, key: RPVideoSampleOrientationKey as CFString,
                                                attachmentModeOut: nil) as? NSNumber)?.intValue ?? 1
            let rotation: RTCVideoRotation
            switch orientation {
            case 3: rotation = ._180
            case 6: rotation = ._90
            case 8: rotation = ._270
            default: rotation = ._0
            }
            source.capturer(capturer, didCapture: RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: pixel),
                rotation: rotation, timeStampNs: Int64(seconds * 1_000_000_000)))
            diagnostics.framesSubmitted += 1
            persist()
        }
    }

    private func note(_ state: String, error: String? = nil) {
        diagnostics.state = state
        if let error { diagnostics.lastError = error }
        persist(force: true)
    }

    private func persist(force: Bool = false) {
        let now = ProcessInfo.processInfo.systemUptime
        guard force || now - lastWrite >= 1 else { return }
        lastWrite = now
        diagnostics.updatedAt = Date().timeIntervalSince1970
        if let directory {
            do { try ProbeShared.write(diagnostics, name: ProbeShared.diagnosticsName, directory: directory) }
            catch { NSLog("Solaris diagnostics write failed: %@", error.localizedDescription) }
        }
        if let channel, channel.readyState == .open,
           let data = try? JSONEncoder().encode(diagnostics) {
            _ = channel.sendData(RTCDataBuffer(data: data, isBinary: false))
        }
    }

    private func endpoint(_ query: [URLQueryItem] = []) -> URL {
        var parts = URLComponents(url: config.url!.appendingPathComponent("rest/v1/solaris_signals"),
                                  resolvingAgainstBaseURL: false)!
        parts.queryItems = query.isEmpty ? nil : query
        return parts.url!
    }

    private func request(_ url: URL, method: String = "GET") -> URLRequest {
        var result = URLRequest(url: url)
        result.httpMethod = method
        result.setValue(config.publishableKey, forHTTPHeaderField: "apikey")
        // sb_publishable is an API key, not a user JWT. Do not invent Bearer auth.
        result.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return result
    }

    private func poll() {
        guard !stopped, !polling else { return }
        polling = true
        var query = [URLQueryItem(name: "select", value: "id,kind,payload"),
                     URLQueryItem(name: "room_id", value: "eq.\(config.signalingRoom)"),
                     URLQueryItem(name: "sender", value: "eq.caller")]
        if let sessionID {
            query += [URLQueryItem(name: "payload->>sessionID", value: "eq.\(sessionID)"),
                      URLQueryItem(name: "id", value: "gt.\(lastID)"),
                      URLQueryItem(name: "order", value: "id.asc"),
                      URLQueryItem(name: "limit", value: "100")]
        } else {
            query += [URLQueryItem(name: "kind", value: "eq.offer"),
                      URLQueryItem(name: "created_at", value: "gte.\(ISO8601DateFormatter().string(from: earliestOffer))"),
                      URLQueryItem(name: "order", value: "id.desc"),
                      URLQueryItem(name: "limit", value: "1")]
        }
        network.dataTask(with: request(endpoint(query))) { [weak self] data, response, error in
            guard let self else { return }
            self.queue.async {
                self.polling = false
                guard !self.stopped else { return }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard error == nil, status == 200, let data,
                      let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
                    self.note("신호 조회 실패", error: "HTTP \(status) · \(error?.localizedDescription ?? "키/테이블/RLS 권한 확인")")
                    return
                }
                for row in rows {
                    if self.sessionID != nil, let id = row["id"] as? NSNumber {
                        self.lastID = max(self.lastID, id.int64Value)
                    }
                    guard let kind = row["kind"] as? String,
                          let payload = row["payload"] as? [String: Any] else { continue }
                    self.handle(kind, payload)
                }
            }
        }.resume()
    }

    private func handle(_ kind: String, _ payload: [String: Any]) {
        guard payload["protocol"] as? String == "screen-v031",
              payload["source"] as? String == "windows",
              let incomingSession = payload["sessionID"] as? String,
              UUID(uuidString: incomingSession) != nil else { return }
        if kind == "offer", sessionID == nil, let sdp = payload["sdp"] as? String {
            guard payload["protocol"] as? String == "screen-v031", sdp.contains("m=video") else {
                note("수신기 버전 불일치", error: "Windows에서 0.3.2 화면 수신 파일을 여세요.")
                return
            }
            sessionID = incomingSession
            diagnostics.sessionID = incomingSession
            diagnostics.lastError = ""
            note("offer 수신 · 영상 협상 중")
            peer.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp)) { [weak self] error in
                guard let self else { return }
                self.queue.async {
                    guard !self.stopped else { return }
                    if let error { self.note("offer 적용 실패", error: error.localizedDescription); return }
                    self.remoteReady = true
                    self.pending.forEach { self.peer.add($0) }
                    self.pending.removeAll()
                    self.answer()
                }
            }
        } else if kind == "ice", incomingSession == sessionID,
                  let text = payload["candidate"] as? String, !text.isEmpty {
            let candidate = RTCIceCandidate(sdp: text,
                sdpMLineIndex: (payload["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0,
                sdpMid: payload["sdpMid"] as? String)
            if remoteReady { peer.add(candidate) }
            else if pending.count < 256 { pending.append(candidate) }
        }
    }

    private func answer() {
        peer.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { [weak self] answer, error in
            guard let self else { return }
            self.queue.async {
                guard !self.stopped else { return }
                guard let answer, error == nil else {
                    self.note("answer 생성 실패", error: error?.localizedDescription ?? "SDP 없음"); return
                }
                // ReplayKit/WebRTC may initially ramp from a very conservative
                // screen bitrate.  Advertise the screen budget in the answer so
                // the encoder does not spend the first seconds at a 480p-like
                // bitrate before probing upward.  This does not invent pixels:
                // the capture path still preserves the native ReplayKit size.
                let tunedSDP = self.screenAnswerSDP(answer.sdp)
                let tunedAnswer = RTCSessionDescription(type: .answer, sdp: tunedSDP)
                self.peer.setLocalDescription(tunedAnswer) { [weak self] error in
                    guard let self else { return }
                    self.queue.async {
                        guard !self.stopped else { return }
                        if let error { self.note("answer 적용 실패", error: error.localizedDescription); return }
                        self.send("answer", ["type": "answer", "sdp": tunedSDP]) { success in
                            if success {
                                self.offerPublished = true
                                self.note("answer 전송 완료 · ICE 연결 대기")
                                let candidates = self.localCandidates
                                self.localCandidates.removeAll()
                                candidates.forEach { self.send("ice", $0) }
                            }
                        }
                    }
                }
            }
        }
    }

    private func screenAnswerSDP(_ sdp: String) -> String {
        let lines = sdp.components(separatedBy: "\r\n")
        var output: [String] = []
        var inVideo = false
        var inserted = false

        for line in lines {
            if line.hasPrefix("m=") {
                inVideo = line.hasPrefix("m=video ")
                inserted = false
            }
            output.append(line)
            // b=AS is expressed in kbit/s.  60 Mbit/s leaves room for the
            // native 1920x1324 screen while avoiding an unbounded sender.
            if inVideo && !inserted && line.hasPrefix("c=") {
                output.append("b=AS:60000")
                inserted = true
            }
        }
        return output.joined(separator: "\r\n")
    }

    private func send(_ kind: String, _ payload: [String: Any], attempt: Int = 0,
                      completion: ((Bool) -> Void)? = nil) {
        guard !stopped, let sessionID else { return }
        var envelope = payload
        envelope["sessionID"] = sessionID
        envelope["protocol"] = "screen-v031"
        envelope["source"] = "replaykit"
        let body: [String: Any] = ["room_id": config.signalingRoom, "sender": "callee",
                                   "kind": kind, "payload": envelope]
        var outgoing = request(endpoint(), method: "POST")
        outgoing.httpBody = try? JSONSerialization.data(withJSONObject: body)
        outgoing.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        network.dataTask(with: outgoing) { [weak self] _, response, error in
            guard let self else { return }
            self.queue.async {
                guard !self.stopped else { return }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let ok = error == nil && (200...299).contains(status)
                if !ok, attempt < 2, status == 0 || status == 429 || status >= 500 {
                    self.queue.asyncAfter(deadline: .now() + 1) {
                        self.send(kind, payload, attempt: attempt + 1, completion: completion)
                    }
                    return
                }
                if !ok { self.note("\(kind) 전송 실패", error: "HTTP \(status) · \(error?.localizedDescription ?? "키/RLS 확인")") }
                completion?(ok)
            }
        }.resume()
    }
}

extension BroadcastWebRTCSender: RTCPeerConnectionDelegate, RTCDataChannelDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        queue.async {
            guard !self.stopped else { return }
            let payload: [String: Any] = ["candidate": candidate.sdp,
                "sdpMid": candidate.sdpMid.map { $0 as Any } ?? NSNull(),
                "sdpMLineIndex": candidate.sdpMLineIndex]
            if self.offerPublished { self.send("ice", payload) }
            else if self.localCandidates.count < 256 { self.localCandidates.append(payload) }
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        queue.async {
            guard !self.stopped else { return }
            self.diagnostics.ice = String(describing: newState)
            self.note("ICE 상태: \(newState) · 영상 수신 여부는 Windows 프레임 수로 확인")
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        queue.async {
            guard !self.stopped else { return }
            self.channel = dataChannel
            dataChannel.delegate = self
            self.persist(force: true)
        }
    }
    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        queue.async { if !self.stopped { self.persist(force: true) } }
    }
    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        queue.async {
            guard !self.stopped, dataChannel.readyState == .open else { return }
            let reply = Data("ReplayKit 송신기 응답 (0.3.2)".utf8)
            _ = dataChannel.sendData(RTCDataBuffer(data: reply, isBinary: false))
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
}
