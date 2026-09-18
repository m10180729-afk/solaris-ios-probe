import ReplayKit
import CoreImage
import ImageIO

final class SampleHandler: RPBroadcastSampleHandler, URLSessionTaskDelegate {
    private let queue = DispatchQueue(label: "org.solaris.probe.capture")
    private let gate = NSLock()
    private var busy = false
    private var stats = ProbeStats()
    private var config: ProbeConfig?
    private var directory: URL?
    private var active = false
    private var started = 0.0
    private var lastFrame = 0.0
    private var lastStats = 0.0
    private var windowStart = 0.0
    private var windowCount = 0
    private var context: CIContext?
    private var network: URLSession?
    private var p2pSender: BroadcastWebRTCSender?

    override init() {
        super.init()
        NSLog("Solaris broadcast handler initialized (%@)", ProbeShared.appVersion)
        if let group = ProbeShared.group() {
            _ = writeLaunchDiagnostic(directory: group.url, state: "확장 객체 초기화 완료 · 방송 시작 콜백 대기")
        } else {
            NSLog("Solaris extension App Group unavailable")
        }
    }

    override func broadcastStarted(withSetupInfo setupInfo: [String : NSObject]?) {
        queue.async { [self] in
            guard let group = ProbeShared.group() else {
                fail("확장이 App Group을 열지 못했습니다. 재서명된 그룹 권한을 확인하세요.")
                return
            }
            // Write a launch marker before reading configuration or constructing
            // WebRTC. This makes early extension failures diagnosable from the app.
            directory = group.url
            guard writeLaunchDiagnostic(directory: group.url, state: "방송 시작 콜백 실행") else {
                fail("방송 확장이 진단 파일을 저장하지 못했습니다. App Group 쓰기 권한을 확인하세요.")
                return
            }
            let value = try? ProbeShared.read(ProbeConfig.self,
                                              name: ProbeShared.configName,
                                              directory: group.url)
            let p2p = try? ProbeShared.read(P2PBroadcastConfig.self,
                                            name: ProbeShared.p2pConfigName,
                                            directory: group.url)
            guard value?.valid == true || p2p?.valid == true else {
                writeLaunchDiagnostic(directory: group.url, state: "설정 없음 또는 설정 형식 오류")
                fail("LAN 또는 WebRTC 방송 설정을 앱에서 먼저 저장하세요.")
                return
            }
            // Screen broadcasting takes priority; do not also send to a stale LAN receiver.
            config = p2p?.valid == true ? nil : (value?.valid == true ? value : nil)
            stats = ProbeStats()
            stats.state = "방송 중"
            started = ProcessInfo.processInfo.systemUptime
            windowStart = started
            windowCount = 0
            releaseFrame()
            lastFrame = 0
            lastStats = 0
            if config != nil {
                // Do not allocate a second image-processing/network path for WebRTC.
                context = CIContext(options: [.cacheIntermediates: false])
                let settings = URLSessionConfiguration.ephemeral
                settings.timeoutIntervalForRequest = 3
                settings.timeoutIntervalForResource = 4
                settings.httpMaximumConnectionsPerHost = 1
                settings.urlCache = nil
                settings.httpCookieStorage = nil
                settings.connectionProxyDictionary = [:]
                network = URLSession(configuration: settings, delegate: self, delegateQueue: nil)
            }
            if let p2p, p2p.valid {
                writeLaunchDiagnostic(directory: group.url, state: "WebRTC 송신기 초기화 중")
                p2pSender = BroadcastWebRTCSender(config: p2p, directory: group.url)
                p2pSender?.start()
            }
            active = true
            saveStats(force: true)
        }
    }

    @discardableResult
    private func writeLaunchDiagnostic(directory: URL, state: String) -> Bool {
        var d = BroadcastDiagnostics()
        d.state = state
        d.updatedAt = Date().timeIntervalSince1970
        do {
            try ProbeShared.write(d, name: ProbeShared.diagnosticsName, directory: directory)
            return true
        } catch {
            let e = error as NSError
            NSLog("Solaris launch diagnostic write failed: %@ / %ld", e.domain, e.code)
            return false
        }
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        // ReplayKit serializes callbacks. Synchronous counting plus a one-frame
        // gate prevents an unbounded retained-buffer queue in this memory-limited extension.
        queue.sync { [self] in
            guard active else { return }
            switch sampleBufferType {
            case .video:
                stats.videoSamples += 1
                p2pSender?.capture(sampleBuffer)
                if let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
                    stats.sourceWidth = CVPixelBufferGetWidth(buffer)
                    stats.sourceHeight = CVPixelBufferGetHeight(buffer)
                }
                let now = ProcessInfo.processInfo.systemUptime
                if config != nil, now - lastFrame >= 0.2 {
                    gate.lock()
                    let occupied = busy
                    if !occupied { busy = true }
                    gate.unlock()
                    if occupied { stats.busyDrops += 1 }
                    else {
                        lastFrame = now
                        queue.async { [self] in sendPreview(sampleBuffer) }
                    }
                }
            case .audioApp: stats.appAudioSamples += 1
            case .audioMic: stats.micAudioSamples += 1
            @unknown default: break
            }
            saveStats()
        }
    }

    private func releaseFrame() {
        gate.lock()
        busy = false
        gate.unlock()
    }

    private func sendPreview(_ sample: CMSampleBuffer) {
        guard active, let value = config, let endpoint = value.url, let network,
              let pixel = CMSampleBufferGetImageBuffer(sample), let context else {
            releaseFrame()
            return
        }
        autoreleasepool {
            var image = CIImage(cvPixelBuffer: pixel)
            if let orientation = CMGetAttachment(sample, key: RPVideoSampleOrientationKey as CFString,
                                                  attachmentModeOut: nil) as? NSNumber {
                image = image.oriented(forExifOrientation: orientation.int32Value)
            }
            let scale = min(1.0, 720.0 / max(image.extent.width, image.extent.height))
            image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
                  let jpeg = context.jpegRepresentation(of: image, colorSpace: colorSpace,
                    options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.65]) else {
                stats.lastError = "JPEG 변환 실패"
                releaseFrame()
                return
            }
            stats.previewWidth = Int(image.extent.width.rounded())
            stats.previewHeight = Int(image.extent.height.rounded())
            var request = URLRequest(url: endpoint.appendingPathComponent("frame"))
            request.httpMethod = "POST"
            request.httpBody = jpeg
            request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
            request.setValue(value.token, forHTTPHeaderField: "X-Solaris-Token")
            request.setValue(stats.session, forHTTPHeaderField: "X-Solaris-Session")
            request.setValue(String(stats.captureFPS), forHTTPHeaderField: "X-Capture-FPS")
            request.setValue("\(stats.sourceWidth)x\(stats.sourceHeight)", forHTTPHeaderField: "X-Source-Size")
            request.setValue("\(stats.previewWidth)x\(stats.previewHeight)", forHTTPHeaderField: "X-Preview-Size")
            let session = stats.session
            network.dataTask(with: request) { [weak self] _, response, error in
                guard let self else { return }
                self.queue.async {
                    guard self.stats.session == session else { return }
                    defer { self.releaseFrame() }
                    guard self.active else { return }
                    if let http = response as? HTTPURLResponse, http.statusCode == 200, error == nil {
                        self.stats.sentFrames += 1
                        self.stats.lastError = ""
                    } else {
                        self.stats.networkErrors += 1
                        self.stats.lastError = "전송 실패: \((response as? HTTPURLResponse)?.statusCode ?? 0) / \(error?.localizedDescription ?? "HTTP 오류")"
                    }
                    self.saveStats()
                }
            }.resume()
        }
    }

    // Never follow redirects carrying the LAN session token or screen images.
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    override func broadcastPaused() {
        queue.async { [self] in active = false; stats.state = "일시정지"; saveStats(force: true) }
    }
    override func broadcastResumed() {
        queue.async { [self] in
            active = true
            stats.state = "방송 중"
            windowStart = ProcessInfo.processInfo.systemUptime
            windowCount = stats.videoSamples
            saveStats(force: true)
        }
    }
    override func broadcastFinished() {
        queue.sync { [self] in
            active = false
            stats.state = "종료"
            saveStats(force: true)
            network?.invalidateAndCancel()
            network = nil
            p2pSender?.stop()
            p2pSender = nil
            context = nil
            releaseFrame()
        }
    }

    private func saveStats(force: Bool = false) {
        let now = ProcessInfo.processInfo.systemUptime
        guard force || now - lastStats >= 1 else { return }
        let interval = now - windowStart
        if interval >= 1 {
            stats.captureFPS = Double(stats.videoSamples - windowCount) / interval
            windowStart = now
            windowCount = stats.videoSamples
        }
        stats.elapsed = max(0, now - started)
        stats.updatedAt = Date().timeIntervalSince1970
        lastStats = now
        if let directory {
            do { try ProbeShared.write(stats, name: ProbeShared.statsName, directory: directory) }
            catch { stats.lastError = "통계 저장 실패: \(error.localizedDescription)" }
        }
    }

    private func fail(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            self?.finishBroadcastWithError(NSError(domain: "SolarisProbe", code: 1,
                userInfo: [NSLocalizedDescriptionKey: message]))
        }
    }
}
