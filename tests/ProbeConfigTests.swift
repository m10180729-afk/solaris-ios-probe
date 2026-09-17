import Foundation

@main
struct ProbeConfigTests {
    static func main() {
        let token = String(repeating: "a", count: 64)
        for address in ["http://192.168.0.2:8765", "http://10.0.0.2:1234/", "http://172.31.0.2:65535"] {
            precondition(ProbeConfig(endpoint: address, token: token).valid, address)
        }
        for address in ["https://192.168.0.2:8765", "http://8.8.8.8:8765", "http://127.0.0.1:8765",
                        "http://192.168.0.2", "http://192.168.0.2:80", "http://172.32.0.1:8765",
                        "http://pc.local:8765", "http://192.168.0.2:8765/path", "http://192.168.0.2:8765/?q=a",
                        "http://user@192.168.0.2:8765", "http://192.168.0.2:8765/#fragment"] {
            precondition(!ProbeConfig(endpoint: address, token: token).valid, address)
        }
        for invalid in ["", "abc", String(repeating: "G", count: 64), String(repeating: "a", count: 65)] {
            precondition(!ProbeConfig(endpoint: "http://192.168.0.2:8765", token: invalid).valid)
        }
        let key = "sb_publishable_" + String(repeating: "a", count: 32)
        precondition(P2PBroadcastConfig(projectURL: "https://abcdefghijklmnop.supabase.co",
                                        publishableKey: key,
                                        roomID: "solaris-test-3").valid)
        for url in ["http://abcdefghijklmnop.supabase.co", "https://supabase.com",
                    "https://abcdefghijklmnop.supabase.co/path", "not-a-url"] {
            precondition(!P2PBroadcastConfig(projectURL: url,
                                             publishableKey: key,
                                             roomID: "solaris-test-3").valid)
        }
        precondition(!P2PBroadcastConfig(projectURL: "https://abcdefghijklmnop.supabase.co",
                                         publishableKey: "sb_secret_do-not-use",
                                         roomID: "solaris-test-3").valid)
        precondition(!P2PBroadcastConfig(projectURL: "https://test.supabase.co",
                                         publishableKey: "sb_publishable_",
                                         roomID: "solaris-test-3").valid)
        let screen = P2PBroadcastConfig(projectURL: "https://test.supabase.co",
                                        publishableKey: key, roomID: "same-room")
        precondition(screen.signalingRoom == "same-room-screen-v031")
        let report = BroadcastDiagnostics()
        let encoded = try! JSONEncoder().encode(report)
        precondition(try! JSONDecoder().decode(BroadcastDiagnostics.self, from: encoded).version == "0.3.1")
        precondition(!String(data: encoded, encoding: .utf8)!.contains(key))
        print("PASS: shared Swift LAN and P2P configuration validation (not an iOS device test)")
    }
}
