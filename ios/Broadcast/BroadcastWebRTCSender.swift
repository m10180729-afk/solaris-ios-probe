import Foundation
import ReplayKit
import WebRTC

// Peer operations are serialized on queue. ReplayKit callbacks never wait for
// the encoder: capture keeps one newest pending frame behind a small lock.
final class BroadcastWebRTCSender: NSObject {
    private struct PendingVideoFrame {
        let pixel: CVPixelBuffer
        let rotation: RTCVideoRotation
        let timeStampNs: Int64
        let callbackFPS: Double
    }

    private let config: P2PBroadcastConfig
    private let directory: URL?
    private let queue = DispatchQueue(label: "org.solaris.probe.webrtc")
    private let frameGate = NSLock()
    private let factory: RTCPeerConnectionFactory
    private let source: RTCVideoSource
    private let capturer: RTCVideoCapturer
    private var quality: ScreenQuality
    private var bitrateProfile: BroadcastBitrateProfile
    private var videoTrack: RTCVideoTrack!
    private var videoSender: RTCRtpSender?
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
    private var callbackWindowStart = 0.0
    private var callbackWindowFrames = 0
    private var latestCallbackFPS = 0.0
    private var pendingFrame: PendingVideoFrame?
    private var framePumpRunning = false
    private var frameInputClosed = false
    private var senderQueueDrops = 0
    private var lastOutputFormat = ""
    private var negotiationRevision = -1
    private var statsPending = false
    private var previousStatsTime = 0.0
    private var previousEncoded: Int64 = 0
    private var previousBytes: Int64 = 0
    private var previousEncodeTime = 0.0
    // Windows must start first; stale offers older than five minutes are ignored.
    private let earliestOffer = Date().addingTimeInterval(-300)

    init(config: P2PBroadcastConfig, directory: URL?) {
        self.config = config
        self.directory = directory
        // No App Group entitlement: host defaults are NOT a settings channel.
        // The receiver sends the selected preset in its offer and over the DC.
        self.quality = ScreenQuality.extensionDefault
        self.bitrateProfile = BroadcastBitrateProfile.maximum
        RTCInitializeSSL()
        let encoderFactory = RTCDefaultVideoEncoderFactory()
        // The build21 diagnostic proved that automatic negotiation selected
        // VP8/libvpx (software) and took ~85ms per encoded frame.  Prefer the
        // iOS H.264 implementation so VideoToolbox can perform the hardware
        // encode path.  VP8 remains available only when the Windows receiver
        // explicitly asks for the compatibility mode.
        let h264Codecs = encoderFactory.supportedCodecs().filter {
            $0.name.uppercased() == "H264" &&
            $0.parameters["packetization-mode"] == "1" &&
            ($0.parameters["profile-level-id"] ?? "").lowercased().hasPrefix("42e0")
        }
        // Match Chromium's constrained-baseline profile, but prefer the
        // highest level the current iPad says its VideoToolbox can encode.
        if let h264 = h264Codecs.max(by: {
            ($0.parameters["profile-level-id"] ?? "") <
            ($1.parameters["profile-level-id"] ?? "")
        }) {
            encoderFactory.preferredCodec = h264
        }
        factory = RTCPeerConnectionFactory(encoderFactory: encoderFactory,
                                           decoderFactory: RTCDefaultVideoDecoderFactory())
        // Mark this as a screen-cast source.  A generic video source lets
        // WebRTC's camera-oriented adaptation logic resize the track when it
        // sees bandwidth pressure.  The native WebRTC 153 API has a separate
        // screen-cast source specifically so the encoder can preserve text
        // and the requested dimensions.
        source = factory.videoSource(forScreenCast: true)
        capturer = RTCVideoCapturer(delegate: source)
        super.init()
        diagnostics.room = config.roomID
        diagnostics.qualityID = quality.id
        diagnostics.bitrateID = bitrateProfile.id
        diagnostics.requestedMinMbps = Double(bitrateProfile.minBitrateBps) / 1_000_000
        diagnostics.requestedMaxMbps = Double(bitrateProfile.maxBitrateBps) / 1_000_000
        diagnostics.targetFPS = quality.fps
        diagnostics.requestedCodec = "auto"
        let rtc = RTCConfiguration()
        rtc.sdpSemantics = .unifiedPlan
        rtc.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]),
                          RTCIceServer(urlStrings: ["stun:global.stun.twilio.com:3478"])]
        peer = factory.peerConnection(with: rtc,
            constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self)
        videoTrack = factory.videoTrack(with: source, trackId: "solaris-screen")
        videoTrack.isEnabled = true
        videoSender = peer.add(videoTrack, streamIds: ["solaris-screen-stream"])
        applyVideoSenderPolicy()
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
                self?.collectStats()
                self?.poll()
            }
            self.timer = timer
            timer.resume()
        }
    }

    func stop() {
        frameGate.lock()
        frameInputClosed = true
        pendingFrame = nil
        frameGate.unlock()
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
        guard let pixel = CMSampleBufferGetImageBuffer(sample) else { return }
        let seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
        guard seconds.isFinite, seconds >= 0,
              seconds < Double(Int64.max) / 1_000_000_000 else { return }
        let orientation = (CMGetAttachment(sample, key: RPVideoSampleOrientationKey as CFString,
                                            attachmentModeOut: nil) as? NSNumber)?.intValue ?? 1
        let rotation: RTCVideoRotation
        switch orientation {
        case 3: rotation = ._180
        case 6: rotation = ._90
        case 8: rotation = ._270
        default: rotation = ._0
        }

        // ReplayKit must never wait for the encoder. Keep exactly one pending
        // pixel buffer and replace it with the newest frame if WebRTC is busy.
        // This avoids both an unbounded extension-memory queue and the old
        // synchronous back-pressure that reduced ReplayKit callbacks to ~30.
        let now = ProcessInfo.processInfo.systemUptime
        frameGate.lock()
        guard !frameInputClosed else { frameGate.unlock(); return }
        callbackWindowFrames += 1
        if callbackWindowStart == 0 { callbackWindowStart = now }
        if now - callbackWindowStart >= 1 {
            latestCallbackFPS = Double(callbackWindowFrames) / (now - callbackWindowStart)
            callbackWindowFrames = 0
            callbackWindowStart = now
        }
        if pendingFrame != nil { senderQueueDrops += 1 }
        pendingFrame = PendingVideoFrame(pixel: pixel, rotation: rotation,
            timeStampNs: Int64(seconds * 1_000_000_000), callbackFPS: latestCallbackFPS)
        let shouldStartPump = !framePumpRunning
        if shouldStartPump { framePumpRunning = true }
        frameGate.unlock()
        if shouldStartPump {
            queue.async { [weak self] in self?.processNextFrame() }
        }
    }

    private func processNextFrame() {
        frameGate.lock()
        guard let frame = pendingFrame, !frameInputClosed else {
            pendingFrame = nil
            framePumpRunning = false
            frameGate.unlock()
            return
        }
        pendingFrame = nil
        let dropped = senderQueueDrops
        frameGate.unlock()

        guard !stopped else { return }
        let now = ProcessInfo.processInfo.systemUptime
        // Submit every ReplayKit callback that survives the bounded pump.
        // RTCVideoSource enforces the selected FPS using frame timestamps;
        // a second wall-clock gate caused 60Hz/30Hz jitter to discard frames.
        lastFrame = now
        diagnostics.callbackFPS = frame.callbackFPS
        diagnostics.senderQueueDrops = dropped

        let width = CVPixelBufferGetWidth(frame.pixel)
        let height = CVPixelBufferGetHeight(frame.pixel)
        diagnostics.sourceWidth = width
        diagnostics.sourceHeight = height
        diagnostics.sourceAspect = String(format: "%.4f", Double(width) / Double(max(1, height)))
        fpsWindowFrames += 1
        if fpsWindowStart == 0 { fpsWindowStart = now }
        if now - fpsWindowStart >= 1 {
            diagnostics.inputFPS = Double(fpsWindowFrames) / (now - fpsWindowStart)
            diagnostics.submittedFPS = diagnostics.inputFPS
            fpsWindowFrames = 0
            fpsWindowStart = now
        }

        let size = "\(width)x\(height)"
        let scale = min(1.0, Double(quality.maxLongSide) / Double(max(width, height)))
        let w = max(2, Int(Double(width) * scale) / 2 * 2)
        let h = max(2, Int(Double(height) * scale) / 2 * 2)
        let format = "\(w)x\(h)@\(quality.fps)"
        if format != lastOutputFormat {
            source.adaptOutputFormat(toWidth: Int32(w), height: Int32(h), fps: Int32(quality.fps))
            lastOutputFormat = format
        }
        if size != lastSize || format != diagnostics.outputFormat {
            diagnostics.outputWidth = w
            diagnostics.outputHeight = h
            diagnostics.outputFormat = format
            diagnostics.scaling = (w == width && h == height) ? "원본 유지" : "송출 축소"
            note("원본 \(width)x\(height) → 출력 \(w)x\(h), \(quality.title)")
            lastSize = size
        }
        source.capturer(capturer, didCapture: RTCVideoFrame(
            buffer: RTCCVPixelBuffer(pixelBuffer: frame.pixel),
            rotation: frame.rotation,
            timeStampNs: frame.timeStampNs))
        diagnostics.framesSubmitted += 1
        persist()
        queue.async { [weak self] in self?.processNextFrame() }
    }

    private func applyVideoSenderPolicy() {
        guard let videoSender else {
            diagnostics.lastError = "RTCRtpSender 생성 실패"
            return
        }

        // WebRTC 153 exposes the real encoder controls through the sender's
        // RTP parameters.  SDP b= lines are only hints; they do not prevent
        // the native encoder from entering a low-resolution adaptation phase.
        let parameters = videoSender.parameters
        let encodings = parameters.encodings
        // getParameters -> modify existing encodings -> setParameters. Adding
        // an encoding before SDP negotiation is not a valid transaction.
        guard !encodings.isEmpty else { return }
        for encoding in encodings {
            encoding.isActive = true
            encoding.maxBitrateBps = NSNumber(value: bitrateProfile.maxBitrateBps)
            // Quality-first viewing profile. This is still a request to the
            // WebRTC congestion controller, not a promise of constant RTP
            // traffic. Static screens naturally use fewer bits.
            encoding.minBitrateBps = NSNumber(value: bitrateProfile.minBitrateBps)
            encoding.maxFramerate = NSNumber(value: quality.fps)
            encoding.scaleResolutionDownBy = NSNumber(value: 1.0)
            encoding.bitratePriority = 4.0
        }
        parameters.encodings = encodings
        // Disable WebRTC's automatic frame-rate/resolution degradation. The
        // bounded newest-frame pump above remains the overload safety valve.
        parameters.degradationPreference = NSNumber(
            value: RTCDegradationPreference.maintainFramerateAndResolution.rawValue
        )
        videoSender.parameters = parameters
        diagnostics.bitrateID = bitrateProfile.id
        diagnostics.requestedMinMbps = Double(bitrateProfile.minBitrateBps) / 1_000_000
        diagnostics.requestedMaxMbps = Double(bitrateProfile.maxBitrateBps) / 1_000_000
        diagnostics.encoderPolicy = "screenCast · \(quality.title) · H264 VideoToolbox · level 5.1 · \(bitrateProfile.title)"
    }

    private func applyQuality(_ id: String, bitrateID: String? = nil, requestID: String = "") {
        guard let selected = ScreenQuality.presets.first(where: { $0.id == id }) else { return }
        quality = selected
        if let bitrateID,
           let selectedBitrate = BroadcastBitrateProfile.profiles.first(where: { $0.id == bitrateID }) {
            bitrateProfile = selectedBitrate
        }
        lastOutputFormat = ""
        lastFrame = 0
        diagnostics.qualityID = selected.id
        diagnostics.targetFPS = selected.fps
        diagnostics.settingsRequestID = requestID
        applyVideoSenderPolicy()
        persist(force: true)
    }

    private func collectStats() {
        guard !stopped, !statsPending, remoteReady else { return }
        statsPending = true
        peer.statistics { [weak self] report in
            guard let self else { return }
            self.queue.async {
                self.statsPending = false
                guard !self.stopped else { return }
                let now = ProcessInfo.processInfo.systemUptime
                for stat in report.statistics.values where stat.type == "outbound-rtp" {
                    let v = stat.values
                    guard (v["kind"] as? String ?? v["mediaType"] as? String) == "video" else { continue }
                    let encoded = (v["framesEncoded"] as? NSNumber)?.int64Value ?? 0
                    let bytes = (v["bytesSent"] as? NSNumber)?.int64Value ?? 0
                    let encodeTime = (v["totalEncodeTime"] as? NSNumber)?.doubleValue ?? 0
                    let elapsed = now - self.previousStatsTime
                    if self.previousStatsTime > 0, elapsed > 0, encoded >= self.previousEncoded, bytes >= self.previousBytes {
                        let frames = encoded - self.previousEncoded
                        self.diagnostics.encodedFPS = Double(frames) / elapsed
                        self.diagnostics.sendMbps = Double(bytes - self.previousBytes) * 8 / elapsed / 1_000_000
                        self.diagnostics.encodeMilliseconds = frames > 0 ? max(0, encodeTime - self.previousEncodeTime) * 1000 / Double(frames) : 0
                    }
                    self.previousStatsTime = now
                    self.previousEncoded = encoded
                    self.previousBytes = bytes
                    self.previousEncodeTime = encodeTime
                    self.diagnostics.encodedFrames = encoded
                    self.diagnostics.sentBytes = bytes
                    self.diagnostics.encodedWidth = (v["frameWidth"] as? NSNumber)?.intValue ?? 0
                    self.diagnostics.encodedHeight = (v["frameHeight"] as? NSNumber)?.intValue ?? 0
                    self.diagnostics.qualityLimitationReason = v["qualityLimitationReason"] as? String ?? "unknown"
                    self.diagnostics.encoderImplementation = v["encoderImplementation"] as? String ?? "not exposed"
                    if let codecID = v["codecId"] as? String, let codec = report.statistics[codecID] {
                        self.diagnostics.negotiatedCodec = codec.values["mimeType"] as? String ?? ""
                        self.diagnostics.codecParameters = codec.values["sdpFmtpLine"] as? String ?? ""
                    }
                }
                for stat in report.statistics.values where stat.type == "candidate-pair" {
                    let v = stat.values
                    let selected = (v["selected"] as? NSNumber)?.boolValue ??
                        ((v["nominated"] as? NSNumber)?.boolValue ?? false)
                    guard selected || v["state"] as? String == "succeeded" else { continue }
                    if let available = (v["availableOutgoingBitrate"] as? NSNumber)?.doubleValue {
                        self.diagnostics.availableOutgoingMbps = available / 1_000_000
                    }
                    if let rtt = (v["currentRoundTripTime"] as? NSNumber)?.doubleValue {
                        self.diagnostics.roundTripMilliseconds = rtt * 1_000
                    }
                }
                for stat in report.statistics.values where stat.type == "remote-inbound-rtp" {
                    let v = stat.values
                    guard (v["kind"] as? String ?? v["mediaType"] as? String) == "video" else { continue }
                    self.diagnostics.remotePacketsLost =
                        (v["packetsLost"] as? NSNumber)?.int64Value ?? 0
                    if let rtt = (v["roundTripTime"] as? NSNumber)?.doubleValue {
                        self.diagnostics.roundTripMilliseconds = rtt * 1_000
                    }
                }
                self.diagnostics.statsUpdatedAt = Date().timeIntervalSince1970
                self.persist(force: true)
            }
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
        if kind == "offer", (sessionID == nil || sessionID == incomingSession), let sdp = payload["sdp"] as? String {
            let revision = (payload["revision"] as? NSNumber)?.intValue ?? 0
            guard revision > negotiationRevision, peer.signalingState == .stable else { return }
            guard payload["protocol"] as? String == "screen-v031", sdp.contains("m=video") else {
                note("수신기 버전 불일치", error: "Windows에서 0.3.2 화면 수신 파일을 여세요.")
                return
            }
            sessionID = incomingSession
            negotiationRevision = revision
            remoteReady = false
            diagnostics.requestedCodec = payload["codecRequest"] as? String ?? "auto"
            if let qualityID = payload["qualityID"] as? String {
                applyQuality(qualityID, bitrateID: payload["bitrateID"] as? String)
            }
            diagnostics.sessionID = incomingSession
            diagnostics.lastError = ""
            note("offer 수신 · 영상 협상 중")
            peer.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp)) { [weak self] error in
                guard let self else { return }
                self.queue.async {
                    guard !self.stopped, self.negotiationRevision == revision else { return }
                    if let error { self.note("offer 적용 실패", error: error.localizedDescription); return }
                    self.remoteReady = true
                    self.pending.forEach { self.peer.add($0) }
                    self.pending.removeAll()
                    self.answer(revision: revision)
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

    private func answer(revision: Int) {
        peer.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { [weak self] answer, error in
            guard let self else { return }
            self.queue.async {
                guard !self.stopped, self.negotiationRevision == revision else { return }
                guard let answer, error == nil else {
                    self.note("answer 생성 실패", error: error?.localizedDescription ?? "SDP 없음"); return
                }
                // Keep only an upper budget; do not force a startup/minimum
                // bandwidth or rewrite codec profile/level parameters.
                let tunedSDP = self.screenAnswerSDP(answer.sdp)
                let tunedAnswer = RTCSessionDescription(type: .answer, sdp: tunedSDP)
                self.peer.setLocalDescription(tunedAnswer) { [weak self] error in
                    guard let self else { return }
                    self.queue.async {
                        guard !self.stopped, self.negotiationRevision == revision else { return }
                        if let error { self.note("answer 적용 실패", error: error.localizedDescription); return }
                        self.applyVideoSenderPolicy()
                        self.send("answer", ["type": "answer", "sdp": tunedSDP, "revision": revision]) { success in
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
            if inVideo && (line.hasPrefix("b=AS:") || line.hasPrefix("b=TIAS:")) { continue }
            output.append(line)
            // b=AS is expressed in kbit/s.  60 Mbit/s leaves room for the
            // native 1920x1324 screen while avoiding an unbounded sender.
            if inVideo && !inserted && line.hasPrefix("c=") {
                output.append("b=AS:60000")
                output.append("b=TIAS:60000000")
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
            // Some WebRTC builds replace RTP encoding parameters during SDP
            // setup. Reapply the quality policy once the transport is live so
            // the first motion-heavy seconds do not begin at camera bitrate.
            if newState == .connected || newState == .completed {
                self.applyVideoSenderPolicy()
            }
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
            if buffer.data.count <= 4096,
               let payload = (try? JSONSerialization.jsonObject(with: buffer.data)) as? [String: Any],
               payload["type"] as? String == "quality", payload["sessionID"] as? String == self.sessionID,
               let id = payload["qualityID"] as? String,
               let requestID = payload["requestID"] as? String, requestID.count <= 64 {
                self.applyQuality(id, bitrateID: payload["bitrateID"] as? String,
                                  requestID: requestID)
                return
            }
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
