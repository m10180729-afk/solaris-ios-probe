import Foundation

// A cold-start email return may arrive before the WebView installs its bridge.
final class AuthReturnRouter {
    static let shared = AuthReturnRouter()
    static let notification = Notification.Name("SolarisAuthReturn")
    private var pending: String?
    func receive(_ url: URL) {
        guard url.scheme == "solaris", url.host == "auth", url.path == "/callback",
              url.user == nil, url.password == nil, url.fragment == nil,
              url.absoluteString.count < 16384 else { return }
        pending = url.absoluteString
        NotificationCenter.default.post(name: Self.notification, object: nil, userInfo: ["url": url.absoluteString])
    }
    func take() -> String? { defer { pending = nil }; return pending }
}
