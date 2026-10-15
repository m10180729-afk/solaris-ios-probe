import Foundation
import CoreFoundation

// Monotonic watchdogs are independent of wall-clock changes and in-flight RPCs.
// Viewer navigation does not stop publication. Ownership/control expiry is
// still bounded independently of viewer count and in-flight requests.
struct BroadcastLifetime {
    private(set) var lastSuccessfulSync: TimeInterval
    private(set) var lastSuccessfulTouch: TimeInterval
    private(set) var hadConnected = false
    private(set) var connected = Set<String>()
    private var emptySince: TimeInterval?
    init(now: TimeInterval) { lastSuccessfulSync = now; lastSuccessfulTouch = now }
    mutating func syncSucceeded(now: TimeInterval) { lastSuccessfulSync = now }
    mutating func touchSucceeded(now: TimeInterval) { lastSuccessfulTouch = now }
    mutating func markConnected(_ id: String, now: TimeInterval) {
        connected.insert(id); hadConnected = true; emptySince = nil
    }
    mutating func markDisconnected(_ id: String, now: TimeInterval) {
        guard connected.remove(id) != nil else { return }
        if connected.isEmpty && hadConnected { emptySince = now }
    }
    mutating func clearConnections() { connected.removeAll(); emptySince = nil }
    func stopReason(now: TimeInterval) -> String? {
        // The backend lease lasts 45 seconds. A delayed control request is not
        // evidence that an established RTP connection has disappeared.
        if now - lastSuccessfulTouch >= 45 { return "broadcast-heartbeat-timeout" }
        if connected.isEmpty, now - lastSuccessfulSync >= 45 { return "signaling-timeout" }
        // A viewer leaving or navigating away does not revoke the publisher's
        // screen-share choice. Keep a healthy, authenticated broadcast available
        // for the next viewer; actual control/auth loss still expires above.
        return nil
    }
}

enum BroadcastContextStore {
    private static func coordinate(_ url: URL, deleting: Bool = false, _ operation: @escaping (URL) throws -> Void) throws {
        let coordinator = NSFileCoordinator(filePresenter: nil)
        var coordinationError: NSError?, operationError: Error?
        coordinator.coordinate(writingItemAt: url, options: deleting ? .forDeleting : [], error: &coordinationError) { location in
            do { try operation(location) } catch { operationError = error }
        }
        if let error = coordinationError { throw error }
        if let error = operationError { throw error }
    }
    static func read(_ directory: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("unified-broadcast.json")) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    @discardableResult static func replace(_ context: [String: Any], directory: URL, refreshOnly: Bool = false) throws -> Bool {
        var written = false
        try coordinate(directory.appendingPathComponent("unified-broadcast.json")) { url in
            var next = context
            if refreshOnly {
                guard let data = try? Data(contentsOf: url), let current = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      current["id"] as? String == context["id"] as? String, current["uid"] as? String == context["uid"] as? String,
                      BroadcastSessionIdentity.sameContextSession(current, context),
                      let expiry = context["expiresAt"] as? Double, expiry.isFinite, expiry > 0,
                      let token = context["accessToken"] as? String, !token.isEmpty,
                      let refresh = context["refreshToken"] as? String, !refresh.isEmpty,
                      expiry >= (current["expiresAt"] as? Double ?? 0) else { return }
                // Equal-expiry stale credentials must not overwrite a token that
                // another process has already rotated. Refresh only auth fields.
                if expiry == (current["expiresAt"] as? Double ?? 0),
                   token != current["accessToken"] as? String || refresh != current["refreshToken"] as? String { return }
                next = current
                for key in ["accessToken", "refreshToken", "expiresAt", "updatedAt"] { next[key] = context[key] }
            }
            try JSONSerialization.data(withJSONObject: next).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            written = true
        }
        return written
    }
    @discardableResult static func remove(_ directory: URL, expectedID: String? = nil) throws -> Bool {
        var removed = false
        try coordinate(directory.appendingPathComponent("unified-broadcast.json"), deleting: true) { url in
            guard FileManager.default.fileExists(atPath: url.path) else { return }
            if let expectedID {
                guard let data = try? Data(contentsOf: url), let current = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], current["id"] as? String == expectedID else { return }
            }
            try FileManager.default.removeItem(at: url); removed = true
        }
        return removed
    }
    // A stopped/replaced broadcast must never be recreated by a late refresh.
    // Coordinate with the host's stop/write and recheck inside the critical section.
    static func commitRefresh(_ session: [String: Any], expected: [String: Any], directory: URL) throws -> [String: Any]? {
        guard let uid = expected["uid"] as? String, UUID(uuidString: uid) != nil,
              let id = expected["id"] as? String, UUID(uuidString: id) != nil,
              BroadcastSessionIdentity.sameSession(session, BroadcastSessionIdentity.contextSession(expected)) else { return nil }
        var committed: [String: Any]?
        try coordinate(directory.appendingPathComponent("unified-broadcast.json")) { url in
            guard let data = try? Data(contentsOf: url),
                  var current = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  current["id"] as? String == expected["id"] as? String,
                  current["uid"] as? String == expected["uid"] as? String,
                  BroadcastSessionIdentity.sameContextSession(current, expected),
                  (session["user"] as? [String: Any])?["id"] as? String == expected["uid"] as? String else { return }
            guard current["refreshToken"] as? String == expected["refreshToken"] as? String else { committed = current; return }
            guard let token = session["access_token"] as? String, !token.isEmpty,
                  let refresh = session["refresh_token"] as? String, !refresh.isEmpty,
                  let expiry = session["expires_at"] as? Double, expiry.isFinite, expiry > 0 else { return }
            guard expiry >= (current["expiresAt"] as? Double ?? 0) else { committed = current; return }
            current["accessToken"] = token; current["refreshToken"] = refresh; current["expiresAt"] = expiry
            try JSONSerialization.data(withJSONObject: current).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try JSONSerialization.data(withJSONObject: session).write(to: directory.appendingPathComponent("shared-session.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            committed = current
        }
        return committed
    }
}

enum BroadcastControlPolicy {
    static func touchDue(now: TimeInterval, lastAttempt: TimeInterval, pending: Bool, captureReady: Bool, tokenUsable: Bool) -> Bool {
        // A refresh or sync request deliberately has no veto over this gate.
        return captureReady && tokenUsable && !pending && now - lastAttempt >= 5
    }
    static func retirePeer(now: TimeInterval, lastSeen: TimeInterval, disconnectedAt: TimeInterval?, connected: Bool) -> Bool {
        if let disconnectedAt { return now - disconnectedAt >= 15 }
        return !connected && now - lastSeen >= 30
    }
    static func refreshOwnedByExtension(now: TimeInterval, diagnostics: [String: Any], context: [String: Any], session: [String: Any]) -> Bool {
        guard let id = context["id"] as? String, UUID(uuidString: id) != nil,
              diagnostics["state"] as? String == "active", diagnostics["id"] as? String == id,
              let updated = diagnostics["updatedAt"] as? Double else { return false }
        let age = now - updated
        return age.isFinite && age >= 0 && age < 20 && BroadcastSessionIdentity.sameSession(session, BroadcastSessionIdentity.contextSession(context))
    }
}

enum BroadcastSessionIdentity {
    static func contextSession(_ context: [String: Any]) -> [String: Any] {
        return ["access_token": context["accessToken"] ?? "", "user": ["id": context["uid"] ?? ""]]
    }
    static func sameContextSession(_ a: [String: Any], _ b: [String: Any]) -> Bool {
        return sameSession(contextSession(a), contextSession(b))
    }
    static func sessionID(_ session: [String: Any]) -> String? {
        guard let token = session["access_token"] as? String else { return nil }
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded), let claims = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = claims["session_id"] as? String, UUID(uuidString: id) != nil,
              claims["sub"] as? String == (session["user"] as? [String: Any])?["id"] as? String else { return nil }
        return id
    }
    static func sameSession(_ a: [String: Any], _ b: [String: Any]) -> Bool {
        guard let first = sessionID(a), let second = sessionID(b) else { return false }
        return first == second && (a["user"] as? [String: Any])?["id"] as? String == (b["user"] as? [String: Any])?["id"] as? String
    }
}

enum ScreenViewport {
    static func scale(_ value: Double) -> Double { value.isFinite ? min(4, max(0.5, value)) : 1 }
    static func offset(x: Double, y: Double, width: Double, height: Double, scale value: Double) -> (x: Double, y: Double) {
        let scale = scale(value)
        let maxX = width.isFinite ? max(0, width * (scale - 1) / 2) : 0
        let maxY = height.isFinite ? max(0, height * (scale - 1) / 2) : 0
        return (x.isFinite ? min(maxX, max(-maxX, x)) : 0, y.isFinite ? min(maxY, max(-maxY, y)) : 0)
    }
}

enum ScreenTelemetry {
    // Network diagnostics contain only bounded numeric measurements and enums.
    // Tokens, SDP, arbitrary strings and unknown nested properties are discarded.
    static func sanitize(_ input: [String: Any]) -> [String: Any] {
        var result: [String: Any] = [:]
        let limits: [String: Double] = ["fps": 240, "frames": 1e12, "width": 16384,
            "height": 16384, "encodeMilliseconds": 60000, "loss": 100,
            "jitter": 60000, "rtt": 60000, "mbps": 10000]
        for (key, limit) in limits {
            if let n = input[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
               n.doubleValue.isFinite, n.doubleValue >= 0, n.doubleValue <= limit { result[key] = n }
        }
        let values: [String: Set<String>] = [
            "state": ["new", "checking", "connecting", "connected", "completed", "disconnected", "failed", "closed"],
            "qualityLimitationReason": ["none", "cpu", "bandwidth", "other"],
            "codec": ["video/H264", "video/VP8", "video/VP9", "video/AV1"]]
        for (key, allowed) in values {
            if let value = input[key] as? String, allowed.contains(value) { result[key] = value }
        }
        return result
    }
}
