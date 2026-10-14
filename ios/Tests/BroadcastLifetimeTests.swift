import Foundation

@main struct BroadcastLifetimeTests {
    static func check(_ value: @autoclosure () -> Bool, _ message: String) { precondition(value(), message) }
    static func main() throws {
        var gate = BroadcastLifetime(now: 100)
        gate.syncSucceeded(now: 114); gate.touchSucceeded(now: 114)
        check(gate.stopReason(now: 120) == nil, "Waiting for the first viewer must be allowed")
        check(!gate.hadConnected, "A pending viewer is not a connected viewer")
        print("PASS: no first-viewer timeout after healthy sync and heartbeat")

        var failedSync = BroadcastLifetime(now: 100)
        failedSync.touchSucceeded(now: 144)
        check(failedSync.stopReason(now: 144.9) == nil, "Sync grace ended early")
        check(failedSync.stopReason(now: 145) == "signaling-timeout", "Stalled control without a live viewer did not stop capture")
        print("PASS: monotonic 45-second signaling watchdog without a live RTP peer")

        var failedTouch = BroadcastLifetime(now: 100)
        failedTouch.syncSucceeded(now: 144)
        check(failedTouch.stopReason(now: 144.9) == nil, "An in-flight control request ended the server lease early")
        check(failedTouch.stopReason(now: 145) == "broadcast-heartbeat-timeout", "Sync cannot replace a successful broadcast heartbeat")
        print("PASS: independent backend-aligned 45-second broadcast lease")

        var controlOutage = BroadcastLifetime(now: 100)
        controlOutage.markConnected("live-rtp", now: 105); controlOutage.touchSucceeded(now: 144)
        check(controlOutage.stopReason(now: 145) == nil, "A stalled sync ended live RTP despite a confirmed ownership heartbeat")
        check(controlOutage.stopReason(now: 189) == "broadcast-heartbeat-timeout", "Live RTP bypassed the expired ownership lease")
        print("PASS: live RTP survives signaling delay but never bypasses the ownership lease")

        gate.markConnected("connection-a", now: 120); gate.markDisconnected("connection-a", now: 121)
        gate.syncSucceeded(now: 150); gate.touchSucceeded(now: 150)
        check(gate.stopReason(now: 150.9) == nil, "Disconnect recovery grace ended early")
        check(gate.stopReason(now: 151) == "viewers-disconnected", "Last disconnected viewer left capture running")
        print("PASS: bounded 30-second grace after the last connected viewer disconnects")

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
        check(BroadcastControlPolicy.touchDue(now: 10, lastAttempt: 5, pending: false, captureReady: true, tokenUsable: true), "Slow sync/refresh prevented the independent ownership heartbeat")
        check(!BroadcastControlPolicy.touchDue(now: 10, lastAttempt: 5, pending: true, captureReady: true, tokenUsable: true), "Duplicate ownership requests escaped the in-flight gate")
        check(!BroadcastControlPolicy.touchDue(now: 10, lastAttempt: 5, pending: false, captureReady: true, tokenUsable: false), "An expired token was reused for a heartbeat")
        print("PASS: independent ownership heartbeat is bounded and requires usable credentials")

        check(!BroadcastControlPolicy.retirePeer(now: 1000, lastSeen: 0, disconnectedAt: nil, connected: true), "A live static-screen peer was closed for missing JavaScript heartbeats")
        check(!BroadcastControlPolicy.retirePeer(now: 114.9, lastSeen: 100, disconnectedAt: 100, connected: false), "Transient ICE disconnect closed before the recovery grace")
        check(BroadcastControlPolicy.retirePeer(now: 115, lastSeen: 100, disconnectedAt: 100, connected: false), "A genuinely disconnected peer remained unbounded")
        check(BroadcastControlPolicy.retirePeer(now: 130, lastSeen: 100, disconnectedAt: nil, connected: false), "An abandoned negotiation occupied a receiver slot forever")
        print("PASS: live peer retention, 15-second transient ICE recovery and bounded abandoned negotiation")

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Solaris-context-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let uid = UUID().uuidString, sid = UUID().uuidString, bid = UUID().uuidString
        func session(_ authID: String, refresh: String, expires: Double) throws -> [String: Any] {
            let claims: [String: Any] = ["sub": uid, "session_id": authID, "exp": expires]
            let encoded = try JSONSerialization.data(withJSONObject: claims).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            return ["user": ["id": uid], "access_token": "fixture." + encoded + ".signature", "refresh_token": refresh, "expires_at": expires]
        }
        let initial = try session(sid, refresh: "old-refresh", expires: 100), refreshed = try session(sid, refresh: "new-refresh", expires: 200)
        let context: [String: Any] = ["uid": uid, "id": bid, "accessToken": initial["access_token"]!, "refreshToken": "old-refresh", "expiresAt": 100.0, "scope": ["kind": "direct", "id": UUID().uuidString]]
        try BroadcastContextStore.replace(context, directory: directory)
        let committed = try BroadcastContextStore.commitRefresh(refreshed, expected: context, directory: directory)
        check(committed?["refreshToken"] as? String == "new-refresh", "Valid refresh was not committed")
        check((committed?["scope"] as? [String: String]) == (context["scope"] as? [String: String]), "A refresh changed broadcast scope")
        print("PASS: refresh updates only the current broadcast and preserves scope")

        let otherLogin = try session(UUID().uuidString, refresh: "other-login", expires: 500)
        check(!BroadcastSessionIdentity.sameSession(initial, otherLogin), "Same-UID re-login adopted a previous auth session")
        check(BroadcastSessionIdentity.sameSession(initial, refreshed), "Token rotation changed the stable auth session identity")
        check(!BroadcastSessionIdentity.sameSession(["user": ["id": uid], "access_token": "bad"], initial), "An unparseable handoff token was trusted")
        print("PASS: shared credential handoff requires the same UID and auth session")

        let status: [String: Any] = ["state": "active", "id": bid, "updatedAt": 1000.0]
        check(BroadcastControlPolicy.refreshOwnedByExtension(now: 1019.9, diagnostics: status, context: context, session: initial), "A live matching ReplayKit session did not own refresh")
        check(!BroadcastControlPolicy.refreshOwnedByExtension(now: 1020, diagnostics: status, context: context, session: initial), "Stale ReplayKit diagnostics blocked host refresh")
        check(!BroadcastControlPolicy.refreshOwnedByExtension(now: 999, diagnostics: status, context: context, session: initial), "A future timestamp blocked host refresh after a clock change")
        check(!BroadcastControlPolicy.refreshOwnedByExtension(now: 1001, diagnostics: status, context: context, session: otherLogin), "An old auth session claimed a re-login's refresh")
        check(!BroadcastControlPolicy.refreshOwnedByExtension(now: 1001, diagnostics: status, context: context, session: [:]), "A signed-out host yielded refresh")
        var wrongBroadcastStatus = status; wrongBroadcastStatus["id"] = UUID().uuidString
        check(!BroadcastControlPolicy.refreshOwnedByExtension(now: 1001, diagnostics: wrongBroadcastStatus, context: context, session: initial), "Another broadcast's diagnostics claimed refresh")
        var stoppedStatus = status; stoppedStatus["state"] = "stopped"
        check(!BroadcastControlPolicy.refreshOwnedByExtension(now: 1001, diagnostics: stoppedStatus, context: context, session: initial), "A stopped extension claimed refresh")
        print("PASS: refresh ownership requires a fresh active broadcast and matching host auth session")

        let late = try BroadcastContextStore.commitRefresh(try session(sid, refresh: "late-refresh", expires: 300), expected: context, directory: directory)
        check(late?["refreshToken"] as? String == "new-refresh", "A late response replaced newer rotated credentials")
        let exported = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("shared-session.json"))) as! [String: Any]
        check(exported["refresh_token"] as? String == "new-refresh", "A late response rewrote the host credential handoff")
        print("PASS: a concurrent newer token wins over the old refresh response")

        var hostRefresh = context
        hostRefresh["accessToken"] = refreshed["access_token"]; hostRefresh["refreshToken"] = "new-refresh"; hostRefresh["expiresAt"] = 200.0
        hostRefresh["scope"] = ["kind": "channel", "id": UUID().uuidString]
        try BroadcastContextStore.replace(context, directory: directory)
        let hostUpdated = try BroadcastContextStore.replace(hostRefresh, directory: directory, refreshOnly: true)
        check(hostUpdated, "A valid host auth update was rejected")
        check((BroadcastContextStore.read(directory)?["scope"] as? [String: String]) == (context["scope"] as? [String: String]), "Host refresh replaced the broadcast scope")
        var equalExpiryStale = hostRefresh; equalExpiryStale["refreshToken"] = "equal-expiry-stale"
        let equalExpiryWritten = try BroadcastContextStore.replace(equalExpiryStale, directory: directory, refreshOnly: true)
        check(!equalExpiryWritten, "Equal-expiry stale host credentials overwrote a rotated token")
        print("PASS: host refresh preserves broadcast scope and rejects equal-expiry stale credentials")

        var changedLoginContext = context
        changedLoginContext["accessToken"] = otherLogin["access_token"]; changedLoginContext["refreshToken"] = "other-login"; changedLoginContext["expiresAt"] = 500.0
        let changedLoginWritten = try BroadcastContextStore.replace(changedLoginContext, directory: directory, refreshOnly: true)
        check(!changedLoginWritten, "Host refresh switched a broadcast to another login with the same UID")
        try BroadcastContextStore.replace(changedLoginContext, directory: directory)
        let afterChangedLogin = try BroadcastContextStore.commitRefresh(refreshed, expected: context, directory: directory)
        check(afterChangedLogin == nil, "Extension refresh adopted another login with the same broadcast ID and UID")
        print("PASS: a replaced auth session rejects old host and extension refreshes")

        try BroadcastContextStore.remove(directory)
        let afterStop = try BroadcastContextStore.commitRefresh(refreshed, expected: context, directory: directory)
        check(afterStop == nil, "Stopped broadcast was recreated by delayed refresh")
        check(BroadcastContextStore.read(directory) == nil, "Refresh recreated a removed context file")
        let revived = try BroadcastContextStore.replace(context, directory: directory, refreshOnly: true)
        check(!revived, "Delayed host broadcastRefresh recreated a stopped capture")
        print("PASS: stop cannot be undone by extension or host refresh")

        var replacement = context; replacement["id"] = UUID().uuidString; replacement["refreshToken"] = "replacement"
        try BroadcastContextStore.replace(replacement, directory: directory)
        let afterReplacement = try BroadcastContextStore.commitRefresh(refreshed, expected: context, directory: directory)
        check(afterReplacement == nil, "Previous broadcast refreshed its replacement")
        let staleStop = try BroadcastContextStore.remove(directory, expectedID: bid)
        check(!staleStop, "A delayed old mediaStop deleted the replacement broadcast")
        check(BroadcastContextStore.read(directory)?["refreshToken"] as? String == "replacement", "New broadcast credentials changed")
        print("PASS: a replacement broadcast survives old refresh and stop completions")

        let raceLock = NSLock(); var raceErrors: [Error] = []
        for _ in 0..<8 {
            try BroadcastContextStore.replace(context, directory: directory)
            DispatchQueue.concurrentPerform(iterations: 2) { index in
                do {
                    if index == 0 { try BroadcastContextStore.remove(directory, expectedID: bid) }
                    else { _ = try BroadcastContextStore.commitRefresh(refreshed, expected: context, directory: directory) }
                } catch { raceLock.lock(); raceErrors.append(error); raceLock.unlock() }
            }
            check(raceErrors.isEmpty, "Coordinated stop/refresh failed")
            check(BroadcastContextStore.read(directory) == nil, "Concurrent refresh revived a stopped broadcast")
            try BroadcastContextStore.replace(context, directory: directory)
            DispatchQueue.concurrentPerform(iterations: 2) { index in
                do {
                    if index == 0 { try BroadcastContextStore.remove(directory, expectedID: bid) }
                    else { try BroadcastContextStore.replace(replacement, directory: directory) }
                } catch { raceLock.lock(); raceErrors.append(error); raceLock.unlock() }
            }
            check(raceErrors.isEmpty, "Coordinated replacement/stop failed")
            check(BroadcastContextStore.read(directory)?["id"] as? String == replacement["id"] as? String, "Concurrent stale stop deleted the replacement broadcast")
        }
        print("PASS: concurrent coordinated stop, refresh and replacement preserve broadcast identity")
        print("PASS: 26 Foundation watchdog/control/context/identity/viewport regression groups; physical ReplayKit, GPU and gestures unverified.")
    }
}
