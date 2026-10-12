import Foundation

// A cold-start email return may arrive before the WebView installs its bridge.
final class AuthReturnRouter {
    static let shared = AuthReturnRouter()
    static let notification = Notification.Name("SolarisAuthReturn")
    private let pending = AuthCallbackPending()
    func receive(_ url: URL) {
        guard let sanitized = pending.receive(url) else { return }
        NotificationCenter.default.post(name: Self.notification, object: nil, userInfo: ["url": sanitized])
    }
    func take() -> String? { pending.peek() }
    func acknowledge(_ url: String) -> Bool { pending.acknowledge(url) }
    func clear() { pending.clear() }
    var metadata: [String: Any] { pending.metadata }
}
