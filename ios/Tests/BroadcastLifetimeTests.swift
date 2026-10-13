import Foundation

@main struct BroadcastLifetimeTests {
    static func check(_ value: @autoclosure () -> Bool, _ message: String) { precondition(value(), message) }
    static func main() {
        var gate = BroadcastLifetime(now: 100)
        gate.syncSucceeded(now: 114); gate.touchSucceeded(now: 114)
        check(gate.stopReason(now: 120) == nil, "Waiting for the first viewer must be allowed")
        check(!gate.hadConnected, "A pending viewer is not a connected viewer")
        print("PASS: no first-viewer timeout after healthy sync and heartbeat")

        var failedSync = BroadcastLifetime(now: 100)
        failedSync.touchSucceeded(now: 114)
        check(failedSync.stopReason(now: 114.9) == nil, "Sync grace ended early")
        check(failedSync.stopReason(now: 115) == "signaling-timeout", "Failed/stalled sync did not stop capture")
        print("PASS: monotonic 15-second sync watchdog")

        var failedTouch = BroadcastLifetime(now: 100)
        failedTouch.syncSucceeded(now: 114)
        check(failedTouch.stopReason(now: 115) == "broadcast-heartbeat-timeout", "Sync cannot replace a successful broadcast heartbeat")
        print("PASS: independent 15-second broadcast heartbeat watchdog")

        gate.markConnected("connection-a", now: 120); gate.markDisconnected("connection-a", now: 121)
        gate.syncSucceeded(now: 125); gate.touchSucceeded(now: 125)
        check(gate.stopReason(now: 125.9) == nil, "Disconnect recovery grace ended early")
        check(gate.stopReason(now: 126) == "viewers-disconnected", "Last disconnected viewer left capture running")
        print("PASS: five-second grace after the last connected viewer disconnects")

        gate.markConnected("connection-b", now: 125.5)
        check(gate.stopReason(now: 130) == nil, "New genuine connection did not cancel disconnect grace")
        print("PASS: a replacement connection cancels last-viewer timeout")

        gate.markConnected("connection-c", now: 130); gate.markDisconnected("connection-b", now: 131)
        gate.syncSucceeded(now: 137); gate.touchSucceeded(now: 137)
        check(gate.stopReason(now: 137) == nil, "One remaining connected viewer must keep capture alive")
        print("PASS: a second viewer survives another viewer leaving")

        gate.markDisconnected("obsolete-connection", now: 138)
        check(gate.connected == ["connection-c"], "Stale callbacks removed a replacement connection")
        print("PASS: unknown/stale disconnect cannot remove a live connection")

        gate.clearConnections()
        check(gate.connected.isEmpty && gate.hadConnected, "Final cleanup must clear live counts and preserve history")
        print("PASS: stopped diagnostics report zero live peers")

        let bad = ScreenTelemetry.sanitize(["fps": Double.nan, "frames": true, "width": -1,
            "height": 20000, "codec": "Bearer private-fixture", "accessToken": "secret-fixture", "sdp": "private-fixture", "state": "arbitrary-message"])
        check(bad.isEmpty, "Unbounded values or secrets entered network diagnostics")
        print("PASS: telemetry drops booleans, nonfinite/invalid values, tokens and SDP")

        let safe = ScreenTelemetry.sanitize(["fps": 59.8, "frames": 2400, "width": 1920, "height": 1080,
            "encodeMilliseconds": 3.2, "qualityLimitationReason": "cpu", "codec": "video/H264", "state": "connected", "rtt": 30])
        check(safe.count == 9 && safe["codec"] as? String == "video/H264", "Valid telemetry was not preserved")
        print("PASS: bounded video telemetry and enum fields survive sanitation")

        check(ScreenViewport.scale(0.1) == 0.5 && ScreenViewport.scale(9) == 4 && ScreenViewport.scale(1) == 1, "Viewport scale is not 0.5 through 4 with fit at 1")
        print("PASS: native fullscreen supports zoom-out and zoom-in limits")

        check(ScreenViewport.scale(Double.infinity) == 1 && ScreenViewport.scale(Double.nan) == 1, "Invalid scale corrupted native geometry")
        print("PASS: invalid native zoom returns to fit")

        let moved = ScreenViewport.offset(x: 2000, y: -2000, width: 1000, height: 600, scale: 2)
        check(moved.x == 500 && moved.y == -300, "Pan escaped zoomed viewport bounds")
        print("PASS: pan remains inside the zoomed fullscreen video")

        let fit = ScreenViewport.offset(x: 500, y: -300, width: 1000, height: 600, scale: 0.5)
        check(fit.x == 0 && fit.y == 0, "Zooming out retained a stale offscreen pan")
        print("PASS: zoom-out/fit clears pan so the video stays centered")
        print("PASS: 14 Foundation broadcast/telemetry/viewport regressions; physical ReplayKit, GPU and gestures unverified.")
    }
}
