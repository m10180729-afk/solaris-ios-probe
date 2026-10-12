import Foundation

// Provider fragments may contain tokens or private error descriptions. Only the
// PKCE query code, the request state and fixed error identifiers reach the WebView.
enum AuthCallbackStatus: String {
    case idle
    case acceptedCode = "accepted_code"
    case acceptedError = "accepted_error"
    case rejectedBase = "rejected_base"
    case rejectedState = "rejected_state"
    case rejectedSize = "rejected_size"
}

struct AuthCallbackResult {
    let url: String?
    let status: AuthCallbackStatus
}

enum AuthCallback {
    private static let errorCodes: Set<String> = [
        "identity_already_exists", "access_denied", "user_cancelled",
        "unsupported_implicit_response", "callback_code_missing", "oauth_callback_error"
    ]
    private static let tokenFields: Set<String> = [
        "access_token", "refresh_token", "id_token", "token_type", "expires_in", "expires_at"
    ]

    static func normalize(_ url: URL) -> AuthCallbackResult {
        guard url.absoluteString.utf8.count < 16384 else {
            return AuthCallbackResult(url: nil, status: .rejectedSize)
        }
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "solaris", parts.percentEncodedHost == "auth",
              parts.percentEncodedPath == "/callback", parts.port == nil,
              parts.user == nil, parts.password == nil else {
            return AuthCallbackResult(url: nil, status: .rejectedBase)
        }
        let query = items(parts.percentEncodedQuery)
        let states = query.filter { $0.name == "solaris_state" }
        guard states.count == 1, let state = states.first?.value,
              state.count == 36, UUID(uuidString: state) != nil else {
            return AuthCallbackResult(url: nil, status: .rejectedState)
        }
        let fragment = parts.percentEncodedFragment ?? ""
        let fragmentItems = items(fragment)
        let allItems = query + fragmentItems
        if allItems.contains(where: { tokenFields.contains($0.name.lowercased()) }) {
            return error(state, "unsupported_implicit_response")
        }
        if !fragment.isEmpty || query.contains(where: { $0.name == "error" || $0.name == "error_code" }) {
            let suppliedCodes = allItems.filter { $0.name == "error_code" }
            let suppliedErrors = allItems.filter { $0.name == "error" }
            let code: String
            if suppliedCodes.count == 1, let value = suppliedCodes.first?.value, errorCodes.contains(value) {
                code = value
            } else if suppliedCodes.isEmpty, suppliedErrors.count == 1,
                      let value = suppliedErrors.first?.value, errorCodes.contains(value) {
                code = value
            } else {
                code = "oauth_callback_error"
            }
            return error(state, code)
        }
        let codes = query.filter { $0.name == "code" }
        guard codes.count == 1, let code = codes.first?.value, !code.isEmpty, code.count <= 4096 else {
            return error(state, "callback_code_missing")
        }
        return AuthCallbackResult(url: callback(state, [URLQueryItem(name: "code", value: code)]), status: .acceptedCode)
    }

    private static func error(_ state: String, _ code: String) -> AuthCallbackResult {
        AuthCallbackResult(url: callback(state, [
            URLQueryItem(name: "error", value: "oauth_callback_error"),
            URLQueryItem(name: "error_code", value: code)
        ]), status: .acceptedError)
    }

    private static func items(_ query: String?) -> [URLQueryItem] {
        guard let query = query, !query.isEmpty else { return [] }
        // URLSearchParams and OAuth form encoding interpret an unescaped plus as
        // a space. Foundation queryItems otherwise treats it as a literal plus.
        return URLComponents(string: "solaris://auth/callback?" +
            query.replacingOccurrences(of: "+", with: "%20"))?.queryItems ?? []
    }

    private static func callback(_ state: String, _ values: [URLQueryItem]) -> String {
        var parts = URLComponents()
        parts.scheme = "solaris"; parts.host = "auth"; parts.path = "/callback"
        parts.queryItems = [URLQueryItem(name: "solaris_state", value: state)] + values
        parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return parts.url!.absoluteString
    }
}

// Reading a cold/warm return does not consume it. An acknowledgement for an old
// return cannot erase a different return that arrived while JavaScript awaited.
final class AuthCallbackPending {
    private let lock = NSLock()
    private var pending: String?
    private var lastStatus: AuthCallbackStatus = .idle

    @discardableResult
    func receive(_ url: URL) -> String? {
        let result = AuthCallback.normalize(url)
        lock.lock(); defer { lock.unlock() }
        lastStatus = result.status
        if let sanitized = result.url { pending = sanitized }
        return result.url
    }

    func peek() -> String? {
        lock.lock(); defer { lock.unlock() }
        return pending
    }

    func acknowledge(_ url: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard pending == url else { return false }
        pending = nil
        return true
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        pending = nil
        lastStatus = .idle
    }

    var metadata: [String: Any] {
        lock.lock(); defer { lock.unlock() }
        return ["pending": pending != nil, "result": lastStatus.rawValue]
    }
}
