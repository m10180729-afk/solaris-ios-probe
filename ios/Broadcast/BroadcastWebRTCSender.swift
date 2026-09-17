import Foundation
import ReplayKit
import WebRTC

final class BroadcastWebRTCSender: NSObject {
    private let config: P2PBroadcastConfig
    private let queue = DispatchQueue(label: "org.solaris.probe.webrtc")
    private let factory: RTCPeerConnectionFactory
    private let source: RTCVideoSource
    private let capturer: RTCVideoCapturer
    private var peer: RTCPeerConnection!
    private var pollTimer: DispatchSourceTimer?
    private var session: URLSession!
    private var lastID: Int64 = 0
    private var remoteDescriptionReady = false
    private var pendingCandidates: [RTCIceCandidate] = []
    private var stopped = false
    private var handledOffer = false

    init(config: P2PBroadcastConfig) {
        self.config = config
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory())
        source = factory.videoSource()
        capturer = RTCVideoCapturer(delegate: source)
        super.init()

        let rtcConfig = RTCConfiguration()
        rtcConfig.sdpSemantics = .unifiedPlan
        rtcConfig.iceServers = [
            RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]),
            RTCIceServer(urlStrings: ["stun:global.stun.twilio.com:3478"])
        ]
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil,
                                              optionalConstraints: nil)
        peer = factory.peerConnection(with: rtcConfig, constraints: constraints, delegate: self)
        let track = factory.videoTrack(with: source, trackId: "solaris-screen")
        _ = peer.add(track, streamIds: ["solaris-screen-stream"])

        let urlConfig = URLSessionConfiguration.ephemeral
        urlConfig.timeoutIntervalForRequest = 5
        urlConfig.timeoutIntervalForResource = 8
        urlConfig.urlCache = nil
        urlConfig.httpCookieStorage = nil
        session = URLSession(configuration: urlConfig)
    }

    func start() {
        queue.async { [weak self] in
            guard let self, !self.stopped else { return }
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now(), repeating: 1.2)
            timer.setEventHandler { [weak self] in self?.poll() }
            self.pollTimer = timer
            timer.resume()
        }
    }

    func stop() {
        queue.sync {
            guard !stopped else { return }
            stopped = true
            pollTimer?.cancel()
            pollTimer = nil
            peer.close()
            session.invalidateAndCancel()
        }
    }

    func capture(_ sampleBuffer: CMSampleBuffer) {
        guard !stopped, let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let presentation = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let timestamp = Int64(CMTimeGetSeconds(presentation) * 1_000_000_000)
        let buffer = RTCCVPixelBuffer(pixelBuffer: pixel)
        let frame = RTCVideoFrame(buffer: buffer,
                                  rotation: rotation(for: sampleBuffer),
                                  timeStampNs: timestamp)
        source.capturer(capturer, didCapture: frame)
    }

    private func rotation(for sampleBuffer: CMSampleBuffer) -> RTCVideoRotation {
        guard let value = CMGetAttachment(sampleBuffer,
                                          key: RPVideoSampleOrientationKey as CFString,
                                          attachmentModeOut: nil) as? NSNumber else { return ._0 }
        switch value.intValue {
        case 3: return ._180
        case 6: return ._90
        case 8: return ._270
        default: return ._0
        }
    }

    private func endpoint(query: [URLQueryItem] = []) -> URL? {
        guard let root = config.url else { return nil }
        var parts = URLComponents(url: root.appendingPathComponent("rest/v1/solaris_signals"),
                                  resolvingAgainstBaseURL: false)
        parts?.queryItems = query
        return parts?.url
    }

    private func request(_ url: URL, method: String = "GET") -> URLRequest {
        var result = URLRequest(url: url)
        result.httpMethod = method
        result.setValue(config.publishableKey, forHTTPHeaderField: "apikey")
        result.setValue("Bearer \(config.publishableKey)", forHTTPHeaderField: "Authorization")
        return result
    }

    private func poll() {
        guard !stopped, let url = endpoint(query: [
            URLQueryItem(name: "select", value: "id,sender,kind,payload"),
            URLQueryItem(name: "room_id", value: "eq.\(config.roomID)"),
            URLQueryItem(name: "id", value: "gt.\(lastID)"),
            URLQueryItem(name: "order", value: "id.asc"),
            URLQueryItem(name: "limit", value: "100")
        ]) else { return }
        session.dataTask(with: request(url)) { [weak self] data, response, _ in
            guard let self, let data,
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let rows = object as? [[String: Any]] else { return }
            self.queue.async {
                for row in rows {
                    if let id = row["id"] as? NSNumber { self.lastID = max(self.lastID, id.int64Value) }
                    guard row["sender"] as? String == "caller",
                          let kind = row["kind"] as? String,
                          let payload = row["payload"] as? [String: Any] else { continue }
                    self.handle(kind: kind, payload: payload)
                }
            }
        }.resume()
    }

    private func handle(kind: String, payload: [String: Any]) {
        if kind == "offer", !handledOffer, let sdp = payload["sdp"] as? String {
            handledOffer = true
            let remote = RTCSessionDescription(type: .offer, sdp: sdp)
            peer.setRemoteDescription(remote) { [weak self] error in
                guard let self, error == nil else { return }
                self.queue.async {
                    self.remoteDescriptionReady = true
                    self.flushCandidates()
                    self.createAnswer()
                }
            }
        } else if kind == "ice", let candidate = payload["candidate"] as? String {
            let mid = payload["sdpMid"] as? String
            let line = (payload["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0
            let ice = RTCIceCandidate(sdp: candidate, sdpMLineIndex: line, sdpMid: mid)
            if remoteDescriptionReady { peer.add(ice) }
            else { pendingCandidates.append(ice) }
        }
    }

    private func flushCandidates() {
        pendingCandidates.forEach { peer.add($0) }
        pendingCandidates.removeAll()
    }

    private func createAnswer() {
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        peer.answer(for: constraints) { [weak self] description, error in
            guard let self, let description, error == nil else { return }
            self.peer.setLocalDescription(description) { [weak self] error in
                guard let self, error == nil else { return }
                self.send(kind: "answer", payload: ["type": "answer", "sdp": description.sdp])
            }
        }
    }

    private func send(kind: String, payload: [String: Any]) {
        guard !stopped, let url = endpoint() else { return }
        let body: [String: Any] = [
            "room_id": config.roomID,
            "sender": "callee",
            "kind": kind,
            "payload": payload
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var outgoing = request(url, method: "POST")
        outgoing.httpBody = data
        outgoing.setValue("application/json", forHTTPHeaderField: "Content-Type")
        outgoing.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        session.dataTask(with: outgoing).resume()
    }
}

extension BroadcastWebRTCSender: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        queue.async { [weak self] in
            let mid: Any = candidate.sdpMid.map { $0 as Any } ?? NSNull()
            self?.send(kind: "ice", payload: [
                "candidate": candidate.sdp,
                "sdpMid": mid,
                "sdpMLineIndex": candidate.sdpMLineIndex
            ])
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
