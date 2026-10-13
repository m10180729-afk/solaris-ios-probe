import Foundation
import CoreFoundation

// Monotonic watchdogs are independent of wall-clock changes and in-flight RPCs.
// A sender may wait for its first viewer; once connected, losing every viewer
// gets a short recovery grace period before ReplayKit is explicitly finished.
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
        if now - lastSuccessfulSync >= 15 { return "signaling-timeout" }
        if now - lastSuccessfulTouch >= 15 { return "broadcast-heartbeat-timeout" }
        if connected.isEmpty, let emptySince, now - emptySince >= 5 { return "viewers-disconnected" }
        return nil
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
