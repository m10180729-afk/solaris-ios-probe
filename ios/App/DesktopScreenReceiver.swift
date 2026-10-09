import AVFoundation
import Foundation
import SwiftUI
import UIKit
import MetalKit
import WebRTC

private let desktopProtocolVersion = "desktop-v1"

final class DesktopScreenReceiver: NSObject, ObservableObject {
    @Published private(set) var state = "수신 대기"
    @Published private(set) var details = "Windows에서 화면 송신을 시작한 뒤 수신을 누르세요. 목표는 1080p60입니다."
    @Published private(set) var videoTrack: RTCVideoTrack?
    @Published private(set) var nativeH264 = false
    @Published private(set) var running = false

    let nativeDisplayView = SolarisH264DisplayView(frame: .zero)

    private let config: P2PBroadcastConfig
    private let queue = DispatchQueue(label: "org.solaris.probe.desktop-receiver")
    private let factory: RTCPeerConnectionFactory
    private let playback: SolarisPlaybackAudioDevice
    private var peer: RTCPeerConnection?
    private var timer: DispatchSourceTimer?
    private var network: URLSession!
    private var stopped = true
    private var polling = false
    private var sessionID: String?
    private var viewerID = UUID().uuidString
    private var lastID: Int64 = 0
    private var remoteReady = false
    private var localAnswerPublished = false
    private var pendingRemoteCandidates: [RTCIceCandidate] = []
    private var pendingLocalCandidates: [[String: Any]] = []
    private var previousFrames: Int64 = 0
    private var previousBytes: Int64 = 0
    private var previousStatsTime = 0.0
    private var rtpRecentFPS = 0.0
    private var rtpRecentMbps = 0.0
    private var rtpWidth = 0
    private var rtpHeight = 0
    private var rtpFramesDecoded: Int64 = 0
    private var rtpPacketsLost: Int64 = 0
    private var nativeChannel: RTCDataChannel?
    private var nativeFrames: [UInt32: NativeFrame] = [:]
    private var nativeReceivedFrames: Int64 = 0
    private var nativeReceivedBytes: Int64 = 0
    private var nativeReceivedPackets: Int64 = 0
    private var nativeIncompleteFramesDropped: Int64 = 0
    private var nativePreviousFrames: Int64 = 0
    private var nativePreviousBytes: Int64 = 0
    private var nativePreviousStatsTime = 0.0
    private var nativeFirstFrameTime = 0.0
    private var nativeRecentFPS = 0.0
    private var nativeRecentMbps = 0.0
    private let earliestOffer = Date().addingTimeInterval(-300)

    private struct NativeFrame {
        let timestampUs: Int64
        let keyFrame: Bool
        var chunks: [Data?]
    }

    init(config: P2PBroadcastConfig) {
        self.config = config
        RTCInitializeSSL()
        let playbackDevice = SolarisPlaybackAudioDevice()
        self.playback = playbackDevice
        self.factory = RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory(), audioDevice: playbackDevice)
        super.init()
        let settings = URLSessionConfiguration.ephemeral
        settings.timeoutIntervalForRequest = 6
        settings.timeoutIntervalForResource = 8
        settings.urlCache = nil
        settings.httpCookieStorage = nil
        self.network = URLSession(configuration: settings, delegate: ProbeLANDelegate(), delegateQueue: nil)
    }

    deinit {
        timer?.cancel()
        peer?.close()
        network.invalidateAndCancel()
    }

    func start() {
        queue.async {
            guard self.stopped else { return }
            self.stopped = false
            self.sessionID = nil
            self.viewerID = UUID().uuidString
            self.lastID = 0
            self.remoteReady = false
            self.localAnswerPublished = false
            self.pendingRemoteCandidates.removeAll()
            self.pendingLocalCandidates.removeAll()
            self.previousFrames = 0
            self.previousBytes = 0
            self.previousStatsTime = 0
            self.rtpRecentFPS = 0
            self.rtpRecentMbps = 0
            self.rtpWidth = 0
            self.rtpHeight = 0
            self.rtpFramesDecoded = 0
            self.rtpPacketsLost = 0
            self.nativeChannel = nil
            self.nativeFrames.removeAll()
            self.nativeReceivedFrames = 0
            self.nativeReceivedBytes = 0
            self.nativeReceivedPackets = 0
            self.nativeIncompleteFramesDropped = 0
            self.nativePreviousFrames = 0
            self.nativePreviousBytes = 0
            self.nativePreviousStatsTime = 0
            self.nativeFirstFrameTime = 0
            self.nativeRecentFPS = 0
            self.nativeRecentMbps = 0
            self.nativeDisplayView.resetDecoder()

            let rtc = RTCConfiguration()
            rtc.sdpSemantics = .unifiedPlan
            rtc.iceServers = [
                RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]),
                RTCIceServer(urlStrings: ["stun:global.stun.twilio.com:3478"])
            ]
            self.peer = self.factory.peerConnection(
                with: rtc,
                constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil),
                delegate: self
            )
            guard self.peer != nil else {
                self.publish("WebRTC 생성 실패", "앱을 다시 실행해 주세요.", running: false)
                self.stopped = true
                return
            }
            self.publish("Windows 송신 대기", "방 ID: \(self.config.roomID) · 목표 1920×1080 60fps", running: true)
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now(), repeating: 1)
            timer.setEventHandler { [weak self] in
                self?.poll()
                self?.collectStats()
            }
            self.timer = timer
            timer.resume()
        }
    }

    func stop() {
        queue.async {
            guard !self.stopped else { return }
            self.stopped = true
            self.timer?.cancel()
            self.timer = nil
            self.peer?.close()
            self.peer = nil
            self.network.getAllTasks { $0.forEach { $0.cancel() } }
            self.sessionID = nil
            self.pendingRemoteCandidates.removeAll()
            self.pendingLocalCandidates.removeAll()
            DispatchQueue.main.async {
                self.videoTrack = nil
                self.nativeH264 = false
                self.running = false
                self.state = "수신 중지"
                self.details = "다시 받을 때 Windows 송신도 중단 후 새로 시작하세요."
            }
        }
    }

    func copyDiagnostic() {
        queue.async {
            let payload: [String: Any] = [
                "version": "0.3.2",
                "build": "49",
                "protocol": desktopProtocolVersion,
                "role": "receiver",
                "session": self.sessionID ?? "",
                "viewerID": self.viewerID,
                "videoTransport": self.nativeH264 ? "webcodecs-h264" : "webrtc-video",
                "peerState": self.peer.map { String(describing: $0.connectionState) } ?? "none",
                "iceState": self.peer.map { String(describing: $0.iceConnectionState) } ?? "none",
                "channelState": self.nativeChannel.map { String(describing: $0.readyState) } ?? "none",
                "nativeH264": self.nativeH264,
                "encodedWidth": self.nativeH264 ? 1920 : 0,
                "encodedHeight": self.nativeH264 ? 1080 : 0,
                "completedAccessUnits": self.nativeReceivedFrames,
                "receivedBytes": self.nativeReceivedBytes,
                "receivedPackets": self.nativeReceivedPackets,
                "pendingIncompleteFrames": self.nativeFrames.count,
                "incompleteFramesEvicted": self.nativeIncompleteFramesDropped,
                "framesEnqueuedToDisplayLayer": self.nativeDisplayView.enqueuedFrames,
                "displayLayerDroppedFrames": self.nativeDisplayView.droppedFrames,
                "displayLayerError": self.nativeDisplayView.lastError,
                "recentCompletedFPS": self.nativeRecentFPS,
                "recentReceiveMbps": self.nativeRecentMbps,
                "rtpRecentFPS": self.rtpRecentFPS,
                "rtpRecentMbps": self.rtpRecentMbps,
                "rtpWidth": self.rtpWidth,
                "rtpHeight": self.rtpHeight,
                "rtpFramesDecoded": self.rtpFramesDecoded,
                "rtpPacketsLost": self.rtpPacketsLost,
                "measurementSeconds": self.nativeFirstFrameTime > 0 ? ProcessInfo.processInfo.systemUptime - self.nativeFirstFrameTime : 0,
                "averageCompletedFPS": self.nativeFirstFrameTime > 0 ? Double(self.nativeReceivedFrames) / max(0.001, ProcessInfo.processInfo.systemUptime - self.nativeFirstFrameTime) : 0
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
                  let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { UIPasteboard.general.string = text }
        }
    }

    private func publish(_ state: String, _ details: String? = nil, running: Bool? = nil) {
        DispatchQueue.main.async {
            self.state = state
            if let details { self.details = details }
            if let running { self.running = running }
        }
    }

    private func endpoint(_ query: [URLQueryItem] = []) -> URL {
        var parts = URLComponents(
            url: config.url!.appendingPathComponent("rest/v1/solaris_signals"),
            resolvingAgainstBaseURL: false
        )!
        parts.queryItems = query.isEmpty ? nil : query
        return parts.url!
    }

    private func request(_ url: URL, method: String = "GET") -> URLRequest {
        var result = URLRequest(url: url)
        result.httpMethod = method
        result.setValue(config.publishableKey, forHTTPHeaderField: "apikey")
        result.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return result
    }

    private func poll() {
        guard !stopped, !polling else { return }
        polling = true
        var query = [
            URLQueryItem(name: "select", value: "id,kind,payload"),
            URLQueryItem(name: "room_id", value: "eq.\(config.desktopSignalingRoom)"),
            URLQueryItem(name: "sender", value: "eq.caller")
        ]
        if let sessionID {
            query += [
                URLQueryItem(name: "payload->>sessionID", value: "eq.\(sessionID)"),
                URLQueryItem(name: "id", value: "gt.\(lastID)"),
                URLQueryItem(name: "order", value: "id.asc"),
                URLQueryItem(name: "limit", value: "100")
            ]
        } else {
            query += [
                URLQueryItem(name: "kind", value: "eq.offer"),
                URLQueryItem(name: "created_at", value: "gte.\(ISO8601DateFormatter().string(from: earliestOffer))"),
                URLQueryItem(name: "order", value: "id.desc"),
                URLQueryItem(name: "limit", value: "1")
            ]
        }
        network.dataTask(with: request(endpoint(query))) { [weak self] data, response, error in
            guard let self else { return }
            self.queue.async {
                self.polling = false
                guard !self.stopped else { return }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard error == nil, status == 200, let data,
                      let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
                    self.publish("신호 조회 실패", "HTTP \(status) · \(error?.localizedDescription ?? "Supabase 권한 확인")", running: true)
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
        guard payload["protocol"] as? String == desktopProtocolVersion,
              payload["source"] as? String == "windows-desktop",
              let incomingSession = payload["sessionID"] as? String,
              UUID(uuidString: incomingSession) != nil else { return }
        if kind == "offer", sessionID == nil,
           let sdp = payload["sdp"] as? String,
           sdp.contains("m=video") || sdp.contains("m=application") {
            sessionID = incomingSession
            let native = payload["videoTransport"] as? String == "webcodecs-h264"
            DispatchQueue.main.async { self.nativeH264 = native }
            publish("Windows offer 수신", native ? "Solaris 하드웨어 H.264 데이터 경로 협상 중" : "WebRTC H.264 호환 경로 협상 중", running: true)
            peer?.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: sdp)) { [weak self] error in
                guard let self else { return }
                self.queue.async {
                    guard !self.stopped, self.sessionID == incomingSession else { return }
                    if let error {
                        self.publish("offer 적용 실패", error.localizedDescription, running: true)
                        return
                    }
                    self.remoteReady = true
                    self.pendingRemoteCandidates.forEach { self.peer?.add($0) }
                    self.pendingRemoteCandidates.removeAll()
                    self.createAnswer()
                }
            }
        } else if kind == "ice", incomingSession == sessionID,
                  let candidate = payload["candidate"] as? String, !candidate.isEmpty {
            let ice = RTCIceCandidate(
                sdp: candidate,
                sdpMLineIndex: (payload["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0,
                sdpMid: payload["sdpMid"] as? String
            )
            if remoteReady { peer?.add(ice) }
            else if pendingRemoteCandidates.count < 256 { pendingRemoteCandidates.append(ice) }
        }
    }

    private func createAnswer() {
        peer?.answer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { [weak self] answer, error in
            guard let self else { return }
            self.queue.async {
                guard !self.stopped, let answer, error == nil else {
                    self.publish("answer 생성 실패", error?.localizedDescription ?? "SDP 없음", running: true)
                    return
                }
                let tunedAnswer = RTCSessionDescription(type: .answer, sdp: self.desktopAnswerSDP(answer.sdp))
                self.peer?.setLocalDescription(tunedAnswer) { [weak self] error in
                    guard let self else { return }
                    self.queue.async {
                        guard !self.stopped else { return }
                        if let error {
                            self.publish("answer 적용 실패", error.localizedDescription, running: true)
                            return
                        }
                        self.send("answer", ["type": "answer", "sdp": tunedAnswer.sdp]) { success in
                            guard success else { return }
                            self.localAnswerPublished = true
                            let candidates = self.pendingLocalCandidates
                            self.pendingLocalCandidates.removeAll()
                            candidates.forEach { self.send("ice", $0) }
                            self.publish("answer 전송 완료", "Windows의 ICE 연결 대기", running: true)
                        }
                    }
                }
            }
        }
    }

    private func desktopAnswerSDP(_ sdp: String) -> String {
        var inVideo = false
        return sdp
            .replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { rawLine -> String in
                let line = String(rawLine)
                if line.hasPrefix("m=") { inVideo = line.hasPrefix("m=video ") }
                guard inVideo, line.hasPrefix("a=fmtp:"),
                      line.range(of: "profile-level-id=", options: .caseInsensitive) != nil else { return line }
                guard let expression = try? NSRegularExpression(
                    pattern: "profile-level-id=([0-9A-Fa-f]{4})[0-9A-Fa-f]{2}",
                    options: .caseInsensitive
                ), let match = expression.firstMatch(
                    in: line,
                    range: NSRange(line.startIndex..., in: line)
                ), let fullRange = Range(match.range(at: 0), in: line),
                   let prefixRange = Range(match.range(at: 1), in: line) else { return line }
                return line.replacingCharacters(
                    in: fullRange,
                    with: "profile-level-id=\(line[prefixRange])33"
                )
            }
            .joined(separator: "\r\n")
    }

    private func send(_ kind: String, _ payload: [String: Any], completion: ((Bool) -> Void)? = nil) {
        guard !stopped, let sessionID else { return }
        var envelope = payload
        envelope["protocol"] = desktopProtocolVersion
        envelope["source"] = "ios-desktop-receiver"
        envelope["sessionID"] = sessionID
        envelope["viewerID"] = viewerID
        let body: [String: Any] = [
            "room_id": config.desktopSignalingRoom,
            "sender": "callee",
            "kind": kind,
            "payload": envelope
        ]
        var outgoing = request(endpoint(), method: "POST")
        outgoing.httpBody = try? JSONSerialization.data(withJSONObject: body)
        outgoing.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        network.dataTask(with: outgoing) { [weak self] _, response, error in
            guard let self else { return }
            self.queue.async {
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let ok = !self.stopped && error == nil && (200...299).contains(status)
                if !ok && !self.stopped {
                    self.publish("\(kind) 전송 실패", "HTTP \(status) · \(error?.localizedDescription ?? "Supabase 권한 확인")", running: true)
                }
                completion?(ok)
            }
        }.resume()
    }

    private func collectStats() {
        guard !stopped, let peer, sessionID != nil else { return }
        if nativeH264 {
            let now = ProcessInfo.processInfo.systemUptime
            let elapsed = now - nativePreviousStatsTime
            if nativePreviousStatsTime > 0, elapsed > 0 {
                let fps = Double(nativeReceivedFrames - nativePreviousFrames) / elapsed
                let mbps = Double(nativeReceivedBytes - nativePreviousBytes) * 8 / elapsed / 1_000_000
                nativeRecentFPS = fps
                nativeRecentMbps = mbps
                publish(
                    "Solaris 네이티브 H.264 수신 중",
                    "수신 완성 \(String(format: "%.1f", fps))fps · \(String(format: "%.1f", mbps))Mbps · 화면 표시 큐 \(nativeDisplayView.enqueuedFrames) · 미완성 프레임 폐기 \(nativeIncompleteFramesDropped)",
                    running: true
                )
            }
            nativePreviousStatsTime = now
            nativePreviousFrames = nativeReceivedFrames
            nativePreviousBytes = nativeReceivedBytes
        }
        peer.statistics { [weak self] report in
            guard let self else { return }
            self.queue.async {
                guard !self.stopped else { return }
                if !self.playback.lastError.isEmpty {
                    self.publish("오디오 출력 오류", self.playback.lastError, running: true)
                }
                let now = ProcessInfo.processInfo.systemUptime
                for stat in report.statistics.values where stat.type == "inbound-rtp" {
                    let values = stat.values
                    let kind = values["kind"] as? String ?? values["mediaType"] as? String
                    guard kind == "video" else { continue }
                    let frames = (values["framesDecoded"] as? NSNumber)?.int64Value ?? 0
                    let bytes = (values["bytesReceived"] as? NSNumber)?.int64Value ?? 0
                    let width = (values["frameWidth"] as? NSNumber)?.intValue ?? 0
                    let height = (values["frameHeight"] as? NSNumber)?.intValue ?? 0
                    self.rtpFramesDecoded = frames
                    self.rtpPacketsLost = (values["packetsLost"] as? NSNumber)?.int64Value ?? 0
                    self.rtpWidth = width
                    self.rtpHeight = height
                    let elapsed = now - self.previousStatsTime
                    var fps = 0.0
                    var mbps = 0.0
                    if self.previousStatsTime > 0, elapsed > 0,
                       frames >= self.previousFrames, bytes >= self.previousBytes {
                        fps = Double(frames - self.previousFrames) / elapsed
                        mbps = Double(bytes - self.previousBytes) * 8 / elapsed / 1_000_000
                    }
                    self.previousStatsTime = now
                    self.previousFrames = frames
                    self.previousBytes = bytes
                    self.rtpRecentFPS = fps
                    self.rtpRecentMbps = mbps
                    if frames > 0 {
                        self.publish(
                            "화면 수신 중",
                            "실제 \(width)×\(height) · \(String(format: "%.1f", fps))fps · \(String(format: "%.1f", mbps))Mbps · 목표 60fps",
                            running: true
                        )
                    }
                }
            }
        }
    }

    private func receiveNativePacket(_ data: Data) {
        // SLH4 + frame id + chunk index/count + timestamp us + flags/reserved.
        guard data.count > 24,
              data[0] == 0x53, data[1] == 0x4C, data[2] == 0x48, data[3] == 0x34 else { return }
        func u16(_ offset: Int) -> UInt16 {
            UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
        }
        func u32(_ offset: Int) -> UInt32 {
            UInt32(data[offset]) | (UInt32(data[offset + 1]) << 8) |
                (UInt32(data[offset + 2]) << 16) | (UInt32(data[offset + 3]) << 24)
        }
        func u64(_ offset: Int) -> UInt64 {
            (0..<8).reduce(UInt64(0)) { $0 | (UInt64(data[offset + $1]) << ($1 * 8)) }
        }
        let frameID = u32(4)
        let chunkIndex = Int(u16(8))
        let chunkCount = Int(u16(10))
        let timestampUs = Int64(bitPattern: u64(12))
        let keyFrame = data[20] & 1 == 1
        guard chunkCount > 0, chunkCount <= 4096, chunkIndex < chunkCount else { return }
        nativeReceivedPackets += 1
        let payload = data.subdata(in: 24..<data.count)
        var frame = nativeFrames[frameID] ?? NativeFrame(
            timestampUs: timestampUs, keyFrame: keyFrame,
            chunks: Array(repeating: nil, count: chunkCount)
        )
        guard frame.chunks.count == chunkCount else { return }
        frame.chunks[chunkIndex] = payload
        if frame.chunks.allSatisfy({ $0 != nil }) {
            var accessUnit = Data()
            frame.chunks.forEach { accessUnit.append($0!) }
            nativeFrames.removeValue(forKey: frameID)
            if nativeFirstFrameTime == 0 { nativeFirstFrameTime = ProcessInfo.processInfo.systemUptime }
            nativeReceivedFrames += 1
            nativeReceivedBytes += Int64(accessUnit.count)
            nativeDisplayView.enqueueAnnexBFrame(
                accessUnit,
                presentationTimeUs: frame.timestampUs,
                keyFrame: frame.keyFrame
            )
        } else {
            nativeFrames[frameID] = frame
        }
        if nativeFrames.count > 8 {
            for id in nativeFrames.keys.sorted().prefix(nativeFrames.count - 8) {
                nativeFrames.removeValue(forKey: id)
                nativeIncompleteFramesDropped += 1
            }
        }
    }
}

extension DesktopScreenReceiver: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        queue.async {
            guard !self.stopped else { return }
            let payload: [String: Any] = [
                "candidate": candidate.sdp,
                "sdpMid": candidate.sdpMid.map { $0 as Any } ?? NSNull(),
                "sdpMLineIndex": candidate.sdpMLineIndex
            ]
            if self.localAnswerPublished { self.send("ice", payload) }
            else if self.pendingLocalCandidates.count < 256 { self.pendingLocalCandidates.append(payload) }
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        queue.async {
            guard !self.stopped else { return }
            self.publish("ICE \(newState)", self.details, running: true)
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection,
                        didAdd rtpReceiver: RTCRtpReceiver,
                        streams mediaStreams: [RTCMediaStream]) {
        guard let track = rtpReceiver.track as? RTCVideoTrack else { return }
        DispatchQueue.main.async {
            self.videoTrack = track
            self.state = "영상 트랙 수신"
            self.details = "첫 디코딩 프레임 대기 · 목표 1920×1080 60fps"
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        if let track = stream.videoTracks.first {
            DispatchQueue.main.async { self.videoTrack = track }
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        guard dataChannel.label == "solaris-h264-v1" else { return }
        queue.async {
            guard !self.stopped else { return }
            self.nativeChannel = dataChannel
            dataChannel.delegate = self
            DispatchQueue.main.async { self.nativeH264 = true }
            self.publish("Solaris H.264 채널 연결", "Windows 하드웨어 인코더의 첫 프레임 대기", running: true)
        }
    }
}

extension DesktopScreenReceiver: RTCDataChannelDelegate {
    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        queue.async {
            guard !self.stopped else { return }
            self.publish("H.264 채널 (dataChannel.readyState)", self.details, running: true)
        }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        guard buffer.isBinary else { return }
        queue.async {
            guard !self.stopped, dataChannel === self.nativeChannel else { return }
            self.receiveNativePacket(buffer.data)
        }
    }
}

private struct DesktopVideoSurface: UIViewRepresentable {
    let track: RTCVideoTrack?

    final class Coordinator {
        var track: RTCVideoTrack?
        weak var renderer: RTCMTLVideoView?
    }

    private func configureRefresh(_ view: UIView) {
        if let metal = view as? MTKView {
            metal.preferredFramesPerSecond = view.window?.screen.maximumFramesPerSecond ?? 120
        }
        view.subviews.forEach { configureRefresh($0) }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView(frame: .zero)
        view.videoContentMode = .scaleAspectFit
        view.backgroundColor = .black
        context.coordinator.renderer = view
        configureRefresh(view)
        return view
    }

    func updateUIView(_ view: RTCMTLVideoView, context: Context) {
        configureRefresh(view)
        guard context.coordinator.track !== track else { return }
        if let old = context.coordinator.track { old.remove(view) }
        context.coordinator.track = track
        if let track { track.add(view) }
    }

    static func dismantleUIView(_ view: RTCMTLVideoView, coordinator: Coordinator) {
        coordinator.track?.remove(view)
    }
}

private struct DesktopNativeH264Surface: UIViewRepresentable {
    let view: SolarisH264DisplayView

    func makeUIView(context: Context) -> SolarisH264DisplayView { view }
    func updateUIView(_ uiView: SolarisH264DisplayView, context: Context) {}
}

struct DesktopReceiverView: View {
    @StateObject private var receiver: DesktopScreenReceiver

    init(config: P2PBroadcastConfig) {
        _receiver = StateObject(wrappedValue: DesktopScreenReceiver(config: config))
    }

    var body: some View {
        VStack(spacing: 14) {
            Group {
                if receiver.nativeH264 {
                    DesktopNativeH264Surface(view: receiver.nativeDisplayView)
                } else {
                    DesktopVideoSurface(track: receiver.videoTrack)
                }
            }
                .aspectRatio(16 / 9, contentMode: .fit)
                .background(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            Text(receiver.state).font(.headline)
            Text(receiver.details)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(receiver.running ? "Windows 화면 수신 중지" : "Windows 화면 수신 시작") {
                receiver.running ? receiver.stop() : receiver.start()
            }
            .buttonStyle(.borderedProminent)
            Button("Windows→iPad 수신 진단 복사") { receiver.copyDiagnostic() }
                .buttonStyle(.bordered)
            Text("Windows에서 SolarisNativeHost.exe를 열고 같은 방 ID로 ‘Solaris 하드웨어 60’ 또는 ‘Solaris 하드웨어 120’을 선택하세요. 별도 Moonlight/Apollo 앱은 사용하지 않습니다.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .navigationTitle("Windows 화면 받기")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { receiver.stop() }
    }
}
