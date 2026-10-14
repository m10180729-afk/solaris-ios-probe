import SwiftUI
import WebKit
import UniformTypeIdentifiers
import Security
import CryptoKit
import UserNotifications
import ReplayKit
import Darwin
import WebRTC
import AuthenticationServices

struct UnifiedView: View {
    @State private var picker = false
    var body: some View {
        UnifiedWebView(showPicker: $picker).ignoresSafeArea(edges: .bottom)
            .onOpenURL { AuthReturnRouter.shared.receive($0) }
            .sheet(isPresented: $picker) {
                VStack(spacing: 20) {
                    Text("화면공유 시작").font(.title2.bold())
                    Text("아래 시스템 버튼에서 Solaris를 선택하고 방송을 시작하세요.")
                    BroadcastPicker().frame(width: 60, height: 60)
                    Button("닫기") { picker = false }
                }.padding().presentationDetents([.medium])
            }
    }
}

struct UnifiedWebView: UIViewRepresentable {
    @Binding var showPicker: Bool
    func makeCoordinator() -> UnifiedCoordinator { UnifiedCoordinator(showPicker: $showPicker) }
    func makeUIView(context: Context) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.allowsInlineMediaPlayback = true
        c.mediaTypesRequiringUserActionForPlayback = []
        c.userContentController.add(context.coordinator, name: "solaris")
        let w = WKWebView(frame: .zero, configuration: c)
        w.navigationDelegate = context.coordinator
        w.uiDelegate = context.coordinator
        w.clipsToBounds = true; w.isOpaque = false; w.backgroundColor = .black
        context.coordinator.web = w
        if let url = Bundle.main.url(forResource: "unified", withExtension: "html", subdirectory: "Unified") {
            context.coordinator.appURL = url
            w.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return w
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
}

final class UnifiedCoordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate, ASWebAuthenticationPresentationContextProviding {
    weak var web: WKWebView?
    var appURL: URL?
    private let showPicker: Binding<Bool>
    private let io = DispatchQueue(label: "org.solaris.unified.disk")
    private let disk = UnifiedDisk()
    private var pendingPicker: (id: String, command: String)?
    private var receivers: [String: DesktopScreenReceiver] = [:]
    private weak var receiverFullscreen: UIViewController?
    private var receiverFullscreenID: String?
    private var receiverFullscreenToken: UUID?
    private var receiverConnections: [String: String] = [:]
    private var surfaces: [String: UIHostingController<Build54ScreenSurface>] = [:]
    private var observers: [NSObjectProtocol] = []
    private var authBrowser: ASWebAuthenticationSession?
    private var authEpoch = UUID()
    init(showPicker: Binding<Bool>) {
        self.showPicker = showPicker; super.init()
        observers.append(NotificationCenter.default.addObserver(forName: AuthReturnRouter.notification, object: nil, queue: .main) { [weak self] note in
            if let url = note.userInfo?["url"] as? String { self?.emit(["type": "auth-callback", "url": url]) }
        })
        for (name, state) in [(UIApplication.didEnterBackgroundNotification, "background"), (UIApplication.didBecomeActiveNotification, "foreground")] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.emit(["type": "lifecycle", "state": state])
            })
        }
    }
    deinit { for receiver in receivers.values { receiver.stop() }; for observer in observers { NotificationCenter.default.removeObserver(observer) } }
    private func dismissReceiverFullscreen() {
        let id = receiverFullscreenID, controller = receiverFullscreen
        receiverFullscreenID = nil; receiverFullscreenToken = nil; receiverFullscreen = nil
        controller?.dismiss(animated: false)
        if let id { emit(["type": "media-receive-fullscreen", "enabled": false, "id": id]) }
    }
    private func removeReceiver(_ id: String) {
        // The presented viewer retains its receiver snapshot; dismiss it before
        // stopping any receiver so a stale black surface cannot cover the app.
        if receiverFullscreenID == id { dismissReceiverFullscreen() }
        receiverConnections.removeValue(forKey: id)
        receivers.removeValue(forKey: id)?.stop()
        if let controller = surfaces.removeValue(forKey: id) { controller.willMove(toParent: nil); controller.view.removeFromSuperview(); controller.removeFromParent() }
    }
    private var host: UIViewController? { web?.window?.rootViewController }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { web?.window ?? ASPresentationAnchor() }
    private func present(_ controller: UIViewController) {
        var root = host
        while let p = root?.presentedViewController { root = p }
        root?.present(controller, animated: true)
    }
    private func reply(_ id: String, _ result: Any? = nil, error: Error? = nil) {
        let value: [String: Any] = error.map { ["requestId": id, "error": $0.localizedDescription] } ?? ["requestId": id, "result": result ?? NSNull()]
        emit(value)
    }
    private func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in self?.web?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('solaris-native',{detail:\(json)}))") }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, web?.url == appURL,
              let m = message.body as? [String: Any], m["type"] as? String == "solaris-command",
              let id = m["requestId"] as? String, let command = m["command"] as? String,
              let args = m["args"] as? [String: Any] else { return }
        do {
            switch command {
            case "platform": reply(id, ["platform": "ios", "version": ProbeShared.appVersion, "nativeReceive": true, "mediaSend": true, "canPublish": true, "systemTitlebar": false])
            case "authListen": reply(id, true)
            case "copyText":
                guard let text = args["text"] as? String, text.utf8.count <= 65536 else { throw UnifiedError("복사할 내용을 확인하세요.") }
                UIPasteboard.general.string = text; reply(id, true)
            case "authTake": reply(id, AuthReturnRouter.shared.take())
            case "authAck": reply(id, AuthReturnRouter.shared.acknowledge(args["url"] as? String ?? ""))
            case "authStatus": reply(id, AuthReturnRouter.shared.metadata)
            case "authCancel": authEpoch = UUID(); authBrowser?.cancel(); authBrowser = nil; AuthReturnRouter.shared.clear(); reply(id, true)
            case "authOpen":
                guard let text = args["url"] as? String, let url = URL(string: text), url.scheme == "https", url.user == nil, url.password == nil, url.port == nil,
                      (url.host == "lfwjkaipghctigswxoxq.supabase.co" && url.path == "/auth/v1/authorize") || (url.host == "accounts.google.com" && url.path.hasPrefix("/o/oauth2/")) else { throw UnifiedError("Invalid authentication URL") }
                authEpoch = UUID(); let epoch = authEpoch
                authBrowser?.cancel()
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "solaris") { [weak self] returned, failure in
                    DispatchQueue.main.async {
                        guard let self = self, self.authEpoch == epoch else { return }
                        if let returned = returned { AuthReturnRouter.shared.receive(returned) }
                        else { self.emit(["type": "auth-cancelled"]) }
                        self.authBrowser = nil
                    }
                }
                session.presentationContextProvider = self; authBrowser = session
                guard session.start() else { authBrowser = nil; throw UnifiedError("로그인 브라우저를 열지 못했습니다.") }; reply(id, true)
            case "mediaReceiveStart":
                guard let bid = args["id"] as? String, UUID(uuidString: bid) != nil,
                      let viewer = args["viewerID"] as? String, UUID(uuidString: viewer) != nil,
                      let cid = args["connectionID"] as? String, UUID(uuidString: cid) != nil else { throw UnifiedError("Invalid receiver identity") }
                removeReceiver(bid)
                let receiver = DesktopScreenReceiver(config: P2PBroadcastConfig(projectURL: "", publishableKey: "", roomID: ""))
                receivers[bid] = receiver; receiverConnections[bid] = cid
                let controller = UIHostingController(rootView: Build54ScreenSurface(receiver: receiver))
                surfaces[bid] = controller; host?.addChild(controller)
                controller.view.backgroundColor = .black; controller.view.isUserInteractionEnabled = false
                controller.view.isHidden = true; web?.addSubview(controller.view); controller.didMove(toParent: host)
                receiver.startUnified(id: bid, viewer: viewer, connection: cid, replayKit: args["replayKit"] as? Bool == true,
                    iceServers: args["iceServers"] as? [[String: Any]] ?? [],
                    signal: { [weak self] kind, payload in self?.emit(["type": "media-receiver-signal", "id": bid, "connectionID": cid, "kind": kind, "payload": payload]) },
                    stats: { [weak self] stats in self?.emit(["type": "media-receiver-stats", "id": bid, "connectionID": cid, "stats": stats]) })
                reply(id, true)
            case "mediaReceiveSignal":
                if let bid = args["id"] as? String, let payload = args["payload"] as? [String: Any] { receivers[bid]?.receiveUnified(payload) }
                reply(id, true)
            case "mediaReceiveStop":
                let bid = args["id"] as? String ?? ""
                if let cid = args["connectionID"] as? String, receiverConnections[bid] != cid { reply(id, true); break }
                removeReceiver(bid); reply(id, true)
            case "mediaReceiveLayout":
                guard let web else { reply(id, false); return }
                let viewport = max(1, (args["viewportWidth"] as? NSNumber)?.doubleValue ?? Double(web.bounds.width))
                let scale = web.bounds.width / CGFloat(viewport)
                let items = args["items"] as? [[String: Any]] ?? []
                for view in surfaces.values { view.view.isHidden = true }
                for item in items {
                    guard let bid = item["id"] as? String, let surface = surfaces[bid] else { continue }
                    func n(_ key: String) -> CGFloat { let value = (item[key] as? NSNumber)?.doubleValue ?? 0; return value.isFinite ? CGFloat(value) * scale : 0 }
                    surface.view.frame = CGRect(x: n("x"), y: n("y"), width: max(0, n("width")), height: max(0, n("height")))
                    let mask = CAShapeLayer()
                    mask.path = UIBezierPath(rect: CGRect(x: n("clipX"), y: n("clipY"), width: max(0, n("clipWidth")), height: max(0, n("clipHeight")))).cgPath
                    surface.view.layer.mask = mask
                    surface.view.isHidden = item["visible"] as? Bool != true
                }
                reply(id, true)
            case "mediaReceiveFullscreen":
                if args["enabled"] as? Bool == false { dismissReceiverFullscreen(); reply(id, true); break }
                let bid = args["id"] as? String ?? ""
                guard receivers[bid] != nil, host != nil else { throw UnifiedError("방송이 종료되었습니다.") }
                let token = UUID()
                let controller = UIHostingController(rootView: Build54Fullscreen(receivers: receivers, selected: bid, didSelect: { [weak self] selected in
                    guard let self, self.receiverFullscreenToken == token else { return }
                    self.receiverFullscreenID = selected; self.emit(["type": "media-receive-fullscreen", "enabled": true, "id": selected])
                }, didExit: { [weak self] in
                    guard let self, self.receiverFullscreenToken == token else { return }; self.dismissReceiverFullscreen()
                }))
                dismissReceiverFullscreen(); receiverFullscreen = controller; receiverFullscreenID = bid; receiverFullscreenToken = token
                controller.modalPresentationStyle = .fullScreen; present(controller)
                emit(["type": "media-receive-fullscreen", "enabled": true, "id": bid]); reply(id, true)
            case "pickFile":
                guard pendingPicker == nil else { throw UnifiedError("파일 선택이 진행 중입니다.") }
                pendingPicker = (id, command)
                let p = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: false); p.delegate = self; present(p)
            case "exportFile":
                io.async { [weak self] in
                    guard let self else { return }
                    do {
                        let url = try self.disk.exportURL(args["id"] as? String ?? "")
                        DispatchQueue.main.async { self.present(UIDocumentPickerViewController(forExporting: [url], asCopy: true)); self.reply(id, true) }
                    } catch { self.reply(id, error: error) }
                }
            case "exportLog":
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("Solaris-diagnostics.json")
                try (args["text"] as? String ?? "").write(to: url, atomically: true, encoding: .utf8)
                present(UIDocumentPickerViewController(forExporting: [url], asCopy: true)); reply(id, true)
            case "notify":
                let center = UNUserNotificationCenter.current()
                let content = UNMutableNotificationContent()
                content.title = args["title"] as? String ?? "Solaris"; content.body = args["body"] as? String ?? ""
                center.requestAuthorization(options: [.alert, .sound]) { allowed, _ in
                    if allowed { center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)) }
                }
                reply(id, true)
            case "fullscreen":
                if args["enabled"] as? Bool != true { dismissReceiverFullscreen() }
                reply(id, true)
            case "openExternal":
                guard let text = args["url"] as? String,
                      text.hasPrefix("https://github.com/m10180729-afk/solaris-ios-probe/releases/"), let url = URL(string: text) else { throw UnifiedError("Invalid update URL") }
                UIApplication.shared.open(url); reply(id, true)
            case "broadcastPrepare", "broadcastRefresh":
                guard let group = ProbeShared.group() else { throw UnifiedError("방송 확장과 인증 정보를 공유할 수 없습니다. AltStore 서명에서 앱과 확장의 Solaris App Group이 함께 유지되어야 합니다.") }
                var context = args; context["updatedAt"] = Date().timeIntervalSince1970
                try BroadcastContextStore.replace(context, directory: group.url, refreshOnly: command == "broadcastRefresh")
                if command == "broadcastPrepare" { showPicker.wrappedValue = true }
                reply(id, true)
            case "mediaStop":
                guard let bid = args["id"] as? String, UUID(uuidString: bid) != nil else { throw UnifiedError("Invalid broadcast identity") }
                if let group = ProbeShared.group(), try BroadcastContextStore.remove(group.url, expectedID: bid) { showPicker.wrappedValue = false }
                reply(id, true)
            default:
                io.async { [weak self] in
                    guard let self else { return }
                    do { self.reply(id, try self.disk.command(command, args)) }
                    catch { self.reply(id, error: error) }
                }
            }
        } catch { reply(id, error: error) }
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let pending = pendingPicker else { return }; pendingPicker = nil
        guard let url = urls.first else { reply(pending.id); return }
        io.async { [weak self] in do { self?.reply(pending.id, try self?.disk.source(url)) } catch { self?.reply(pending.id, error: error) } }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let pending = pendingPicker { reply(pending.id); pendingPicker = nil }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url == appURL ? .allow : .cancel)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        for id in Array(receivers.keys) { removeReceiver(id) }
        showPicker.wrappedValue = false
        // A memory-evicted WKWebView is not a user stop. ReplayKit owns its
        // capture/signaling in the separate extension and survives this reload.
        if let url = appURL { webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent()) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: "Solaris", message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler() }); present(a)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: "Solaris", message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) }); a.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) }); present(a)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: "Solaris", message: prompt, preferredStyle: .alert); a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(nil) }); a.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(a.textFields?.first?.text) }); present(a)
    }
}

struct Build54ScreenSurface: View {
    @ObservedObject var receiver: DesktopScreenReceiver
    var body: some View { DesktopVideoSurface(track: receiver.videoTrack).background(Color.black) }
}

struct Build54Fullscreen: View {
    let receivers: [String: DesktopScreenReceiver]
    @State var selected: String
    let didSelect: (String) -> Void
    let didExit: () -> Void
    @State private var zoom: CGFloat = 1
    @State private var pan = CGSize.zero
    private func reset() { zoom = 1; pan = .zero }
    private func bounded(_ value: CGSize, in size: CGSize) -> CGSize {
        let value = ScreenViewport.offset(x: Double(value.width), y: Double(value.height), width: Double(size.width), height: Double(size.height), scale: Double(zoom))
        return CGSize(width: value.x, height: value.y)
    }
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            GeometryReader { geometry in
                if let receiver = receivers[selected] {
                    ZStack {
                        Build54ScreenSurface(receiver: receiver)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .scaleEffect(zoom).offset(pan)
                        FullscreenViewerGestures(zoom: $zoom, pan: $pan, size: geometry.size)
                    }.onChange(of: geometry.size) { size in pan = bounded(pan, in: size) }
                }
            }.clipped().ignoresSafeArea()
            HStack {
                if receivers.count > 1 {
                    Menu("방송 전환") { ForEach(receivers.keys.sorted(), id: \.self) { id in Button(String(id.prefix(8))) { selected = id; didSelect(id) } } }
                }
                Button("화면 맞춤 · \(Int(zoom * 100))%") { reset() }
                Button("전체화면 종료") { didExit() }
            }.padding().background(.ultraThinMaterial).clipShape(RoundedRectangle(cornerRadius: 12)).padding()
        }.onChange(of: selected) { _ in reset() }.onDisappear { reset(); didExit() }
    }
}

// UIKit recognizers also accept iPad trackpad scrolling; a SwiftUI drag alone
// only covers direct dragging. The controls above this transparent layer retain
// their own touches, and the video capture/decoder is never reconfigured.
struct FullscreenViewerGestures: UIViewRepresentable {
    @Binding var zoom: CGFloat
    @Binding var pan: CGSize
    let size: CGSize
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: FullscreenViewerGestures
        private var startZoom: CGFloat = 1
        private var startPan = CGSize.zero
        init(_ parent: FullscreenViewerGestures) { self.parent = parent }
        private func bound(_ value: CGSize) -> CGSize {
            let position = ScreenViewport.offset(x: Double(value.width), y: Double(value.height), width: Double(parent.size.width), height: Double(parent.size.height), scale: Double(parent.zoom))
            return CGSize(width: position.x, height: position.y)
        }
        @objc func pinch(_ recognizer: UIPinchGestureRecognizer) {
            if recognizer.state == .began { startZoom = parent.zoom }
            parent.zoom = CGFloat(ScreenViewport.scale(Double(startZoom * recognizer.scale)))
            parent.pan = bound(parent.pan)
        }
        @objc func drag(_ recognizer: UIPanGestureRecognizer) {
            if recognizer.state == .began { startPan = parent.pan; startZoom = parent.zoom }
            let translation = recognizer.translation(in: recognizer.view)
            if recognizer.numberOfTouches == 0 {
                parent.zoom = CGFloat(ScreenViewport.scale(Double(startZoom) * exp(-Double(translation.y) * 0.002)))
                parent.pan = bound(parent.pan); return
            }
            parent.pan = bound(CGSize(width: startPan.width + translation.x, height: startPan.height + translation.y))
        }
        func gestureRecognizer(_ first: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith second: UIGestureRecognizer) -> Bool { true }
    }
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UIView {
        let view = UIView(); view.backgroundColor = .clear
        let pinch = UIPinchGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pinch(_:)))
        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.drag(_:)))
        pinch.delegate = context.coordinator; pan.delegate = context.coordinator
        pan.maximumNumberOfTouches = 2; pan.allowedScrollTypesMask = .all
        view.addGestureRecognizer(pinch); view.addGestureRecognizer(pan)
        return view
    }
    func updateUIView(_ view: UIView, context: Context) { context.coordinator.parent = self }
}

struct UnifiedError: LocalizedError { let message: String; init(_ message: String) { self.message = message }; var errorDescription: String? { message } }

final class UnifiedDisk {
    private struct Entry: Codable { var path: String; var bookmark: Data?; var name: String; var size: UInt64; var modified: Double; var source: Bool }
    private let root: URL
    private var entries: [String: Entry] = [:]
    init() {
        root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Solaris")
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: root.appendingPathComponent("files.json")), let v = try? JSONDecoder().decode([String: Entry].self, from: data) { entries = v }
    }
    private func save() throws { try JSONEncoder().encode(entries).write(to: root.appendingPathComponent("files.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    func source(_ url: URL) throws -> [String: Any] {
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        guard let size = values.fileSize else { throw UnifiedError("파일 크기를 확인할 수 없습니다.") }
        let id = UUID().uuidString.lowercased(), modified = (values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000
        entries[id] = Entry(path: url.path, bookmark: try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil), name: url.lastPathComponent, size: UInt64(size), modified: modified, source: true)
        try save(); return ["id": id, "name": url.lastPathComponent, "size": size, "modified": modified]
    }
    private func entry(_ id: String) throws -> Entry {
        guard UUID(uuidString: id) != nil, let e = entries[id] else { throw UnifiedError("파일을 다시 선택하세요.") }; return e
    }
    private func url(_ e: Entry) throws -> URL {
        if let bookmark = e.bookmark { var stale = false; return try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) }; return URL(fileURLWithPath: e.path)
    }
    func exportURL(_ id: String) throws -> URL { try url(entry(id)) }
    func command(_ command: String, _ a: [String: Any]) throws -> Any? {
        if command == "vaultGet" || command == "vaultSet" {
            let key = a["key"] as? String ?? ""; guard ["session", "turn", "auth-flow"].contains(key) else { throw UnifiedError("Invalid vault key") }
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Bundle.main.bundleIdentifier ?? "Solaris", kSecAttrAccount as String: key]
            if command == "vaultGet" {
                var q = query; q[kSecReturnData as String] = true; var item: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &item)
                if status == errSecItemNotFound { return nil }; guard status == errSecSuccess, let data = item as? Data else { throw UnifiedError("Keychain 읽기 실패") }
                if key == "session", let group = ProbeShared.group(),
                   let shared = try? Data(contentsOf: group.url.appendingPathComponent("shared-session.json")),
                   let latest = (try? JSONSerialization.jsonObject(with: shared)) as? [String: Any],
                   let stored = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                   BroadcastSessionIdentity.sameSession(latest, stored),
                   (latest["expires_at"] as? Double ?? 0) > (stored["expires_at"] as? Double ?? 0) {
                    let update: [String: Any] = [kSecValueData as String: shared]
                    guard SecItemUpdate(query as CFDictionary, update as CFDictionary) == errSecSuccess else { throw UnifiedError("공유 세션 저장 실패") }
                    return String(data: shared, encoding: .utf8)
                }
                return String(data: data, encoding: .utf8)
            }
            guard let value = a["value"] as? String, value.utf8.count <= 65536 else { throw UnifiedError("Invalid vault value") }
            let update: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
            let result = SecItemUpdate(query as CFDictionary, update as CFDictionary)
            let status = result == errSecItemNotFound ? SecItemAdd(query.merging(update) { _, new in new } as CFDictionary, nil) : result
            guard status == errSecSuccess else { throw UnifiedError("Keychain 저장 실패") }; return true
        }
        if command == "mediaStatus" {
            guard let group = ProbeShared.group(), let data = try? Data(contentsOf: group.url.appendingPathComponent("unified-diagnostics.json")), let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return ["active": false, "nativeAuthRefreshOwner": false, "nativeSignaling": true] }
            let now = Date().timeIntervalSince1970, age = now - (value["updatedAt"] as? Double ?? 0)
            let active = value["state"] as? String == "active" && age >= 0 && age < 20
            var refreshOwner = false
            if active, let context = BroadcastContextStore.read(group.url),
               let raw = (try? self.command("vaultGet", ["key": "session"])) as? String, let stored = raw.data(using: .utf8),
               let session = (try? JSONSerialization.jsonObject(with: stored)) as? [String: Any] {
                refreshOwner = BroadcastControlPolicy.refreshOwnedByExtension(now: now, diagnostics: value, context: context, session: session)
            }
            return ["id": value["id"] ?? NSNull(), "active": active, "nativeSignaling": true, "nativeAuthRefreshOwner": refreshOwner]
        }
        if command == "diagnostics" {
            var result: [String: Any] = ["platform": "ios", "os": UIDevice.current.systemVersion, "version": ProbeShared.appVersion]
            result.merge(SolarisProcessMetrics.snapshot()) { _, new in new }
            if let group = ProbeShared.group(), let data = try? Data(contentsOf: group.url.appendingPathComponent("unified-diagnostics.json")), let value = try? JSONSerialization.jsonObject(with: data) { result["broadcast"] = value }
            return result
        }
        let id = (a["id"] as? String ?? "").lowercased()
        if command == "createReceiver" {
            guard UUID(uuidString: id) != nil, let size = a["size"] as? NSNumber, size.doubleValue >= 0, size.doubleValue <= Double(100 * 1024 * 1024) else { throw UnifiedError("Invalid transfer") }
            let name = (a["name"] as? String ?? "download").replacingOccurrences(of: "[/\\\\:\u{0}-\u{1f}]", with: "_", options: .regularExpression)
            let path = root.appendingPathComponent(id + ".part")
            guard FileManager.default.createFile(atPath: path.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw UnifiedError("저장 파일 생성 실패") }
            entries[id] = Entry(path: path.path, bookmark: nil, name: name, size: size.uint64Value, modified: 0, source: false); try save(); return ["id": id, "name": name]
        }
        let e = try entry(id), file = try url(e), access = file.startAccessingSecurityScopedResource(); defer { if access { file.stopAccessingSecurityScopedResource() } }
        if command == "fileInfo" { guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize else { return nil }; return ["size": size] }
        if command == "hashFile" {
            let f = try FileHandle(forReadingFrom: file); defer { try? f.close() }; var hash = CryptoKit.SHA256()
            while let data = try f.read(upToCount: 65536), !data.isEmpty { hash.update(data: data) }
            return ["sha256": hash.finalize().map { String(format: "%02x", $0) }.joined()]
        }
        if command == "readFile" {
            guard e.source, let offset = a["offset"] as? NSNumber, let length = a["length"] as? NSNumber, offset.doubleValue >= 0, offset.uint64Value <= e.size, (0...32768).contains(length.intValue) else { throw UnifiedError("Invalid read") }
            let values = try file.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            guard UInt64(values.fileSize ?? 0) == e.size, abs((values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000 - e.modified) < 1 else { throw UnifiedError("원본 파일이 변경되었습니다.") }
            let f = try FileHandle(forReadingFrom: file); defer { try? f.close() }; try f.seek(toOffset: offset.uint64Value)
            let data = try f.read(upToCount: min(length.intValue, Int(e.size - offset.uint64Value))) ?? Data(); return ["data": data.base64EncodedString()]
        }
        if command == "writeFile" {
            guard !e.source, let offset = a["offset"] as? NSNumber, offset.doubleValue >= 0,
                  let text = a["data"] as? String, let bytes = Data(base64Encoded: text), bytes.count <= 32768,
                  offset.uint64Value + UInt64(bytes.count) <= e.size else { throw UnifiedError("Invalid write") }
            let f = try FileHandle(forWritingTo: file); defer { try? f.close() }; guard offset.uint64Value <= (try f.seekToEnd()) else { throw UnifiedError("Noncontiguous write") }; try f.seek(toOffset: offset.uint64Value); try f.write(contentsOf: bytes); try f.synchronize(); return true
        }
        if command == "finishFile" {
            guard !e.source, (a["size"] as? NSNumber)?.uint64Value == e.size, UInt64(try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) == e.size else { throw UnifiedError("Incomplete file") }
            let directory = root.appendingPathComponent(id, isDirectory: true); try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let destination = directory.appendingPathComponent(e.name)
            if file == destination { return ["id": id, "name": e.name] }
            try FileManager.default.moveItem(at: file, to: destination); var changed = e; changed.path = destination.path; entries[id] = changed; try save(); return ["id": id, "name": e.name]
        }
        if command == "discardFile" { if !e.source && file.pathExtension == "part" { try? FileManager.default.removeItem(at: file) }; entries.removeValue(forKey: id); try save(); return true }
        throw UnifiedError("Unknown Solaris command")
    }
}
