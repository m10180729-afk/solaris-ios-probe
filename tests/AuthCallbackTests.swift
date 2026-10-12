import Foundation

@main
struct AuthCallbackTests {
    static let state = "6d9f6dc3-16ec-4aca-80d4-3ae0de03b4f7"
    static let secondState = "1b5b3d9b-6167-420b-ad53-83d08a8f04ac"
    static let base = "solaris://auth/callback?solaris_state="

    static func normalized(_ text: String) -> String {
        guard let result = AuthCallback.normalize(URL(string: text)!).url else {
            fatalError("Expected a sanitized callback")
        }
        return result
    }

    static func fields(_ url: String) -> [URLQueryItem] {
        let parts = URLComponents(string: url)!
        precondition(parts.fragment == nil)
        precondition(parts.scheme == "solaris" && parts.host == "auth" && parts.path == "/callback")
        return parts.queryItems!
    }

    static func verifyError(_ input: String, code: String) -> String {
        let result = AuthCallback.normalize(URL(string: input)!)
        precondition(result.status == .acceptedError)
        let safe = result.url!
        let query = fields(safe)
        precondition(query.count == 3)
        precondition(query.contains(URLQueryItem(name: "solaris_state", value: state)))
        precondition(query.contains(URLQueryItem(name: "error", value: "oauth_callback_error")))
        precondition(query.contains(URLQueryItem(name: "error_code", value: code)))
        precondition(!query.contains(where: { $0.name == "code" || $0.name == "access_token" || $0.name == "error_description" }))
        return safe
    }

    static func main() {
        let success = normalized(base + state + "&code=pkce-code&private=discard-me")
        let successQuery = fields(success)
        precondition(successQuery.count == 2)
        precondition(successQuery.contains(URLQueryItem(name: "code", value: "pkce-code")))
        precondition(!success.contains("discard-me"))
        precondition(normalized(base + state + "&code=pkce-code#") == success)
        let opaque = normalized(base + state + "&code=opaque%2Bcode%2Fpart%3D")
        precondition(opaque.contains("%2B"))
        precondition(fields(opaque).contains(URLQueryItem(name: "code", value: "opaque+code/part=")))

        let rawError = base + state + "#error=server_error&error_code=identity_already_exists&error_description=private-user%40example.com"
        let safeError = verifyError(rawError, code: "identity_already_exists")
        precondition(!safeError.contains("private-user"))
        _ = verifyError(base + state + "&error=access_denied&error_description=private-value", code: "access_denied")
        _ = verifyError(base + state + "#error=server_error&error_code=unknown-private-code&error_description=private-value", code: "oauth_callback_error")
        _ = verifyError(base + state + "#error_code=identity_already_exists&error_code=access_denied", code: "oauth_callback_error")
        _ = verifyError(base + state + "&code=do-not-exchange#access_token=private-token&refresh_token=private-refresh", code: "unsupported_implicit_response")
        _ = verifyError(base + state + "#error_code=identity_already_exists&access_token=private-token", code: "unsupported_implicit_response")
        _ = verifyError(base + state + "&access_token=private-token", code: "unsupported_implicit_response")
        _ = verifyError(base + state, code: "callback_code_missing")
        _ = verifyError(base + state + "&code=first&code=second", code: "callback_code_missing")

        for invalid in [
            "https://auth/callback?solaris_state=" + state + "&code=x",
            "solaris://different/callback?solaris_state=" + state + "&code=x",
            "solaris://auth:80/callback?solaris_state=" + state + "&code=x",
            "solaris://user@auth/callback?solaris_state=" + state + "&code=x",
            "solaris://auth/callback/extra?solaris_state=" + state + "&code=x",
            "solaris://auth/%63allback?solaris_state=" + state + "&code=x",
            "solaris://auth/callback?code=x",
            base + "invalid-state&code=x",
            base + state + "&solaris_state=" + secondState + "&code=x",
            base + state + "&code=" + String(repeating: "a", count: 16384)
        ] {
            precondition(AuthCallback.normalize(URL(string: invalid)!).url == nil)
        }

        let pending = AuthCallbackPending()
        precondition(pending.peek() == nil)
        precondition(pending.receive(URL(string: rawError)!) == safeError)
        precondition(pending.peek() == safeError && pending.peek() == safeError)
        precondition(!pending.acknowledge(rawError))
        precondition(pending.peek() == safeError)
        let next = normalized(base + secondState + "&code=new-pkce-code")
        precondition(pending.receive(URL(string: next)!) == next)
        precondition(!pending.acknowledge(safeError))
        precondition(pending.peek() == next)
        precondition(pending.receive(URL(string: "solaris://auth/callback?code=wrong")!) == nil)
        precondition(pending.peek() == next)
        let metadata = String(data: try! JSONSerialization.data(withJSONObject: pending.metadata), encoding: .utf8)!
        for privateValue in [state, secondState, "new-pkce-code", "private-token", "private-user", "solaris://"] {
            precondition(!metadata.contains(privateValue))
        }
        precondition(pending.acknowledge(next))
        precondition(!pending.acknowledge(next) && pending.peek() == nil)
        pending.receive(URL(string: rawError)!)
        pending.clear()
        precondition(pending.peek() == nil)
        precondition(pending.metadata["result"] as? String == "idle")
        print("PASS: Swift PKCE callback sanitization, safe provider errors and pending acknowledgement (not an iOS device test)")
    }
}
