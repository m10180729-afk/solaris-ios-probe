import Foundation

// Do not forward a LAN token to a redirect destination.
final class ProbeLANDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct ProbeConfig: Codable {
    let endpoint: String
    let token: String

    var url: URL? {
        guard let parts = URLComponents(string: endpoint),
              parts.scheme == "http", let host = parts.host,
              Self.isLANv4(host), let port = parts.port, (1024...65535).contains(port),
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { return nil }
        return parts.url
    }

    var valid: Bool {
        url != nil && token.count == 64 && token.allSatisfy { "0123456789abcdef".contains($0) }
    }

    static func isLANv4(_ host: String) -> Bool {
        let chunks = host.split(separator: ".", omittingEmptySubsequences: false)
        guard chunks.count == 4 else { return false }
        let octets = chunks.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }),
              zip(chunks, octets).allSatisfy({ String($0.0) == String($0.1) }) else { return false }
        return octets[0] == 10 || (octets[0] == 172 && (16...31).contains(octets[1]))
            || (octets[0] == 192 && octets[1] == 168)
    }
}

struct P2PBroadcastConfig: Codable {
    let projectURL: String
    let publishableKey: String
    let roomID: String

    // A separate transport room prevents the old WebView callee from answering
    // offers intended for the native ReplayKit extension.
    var signalingRoom: String { roomID + "-screen-v031" }

    var url: URL? {
        guard let parts = URLComponents(string: projectURL),
              parts.scheme == "https", let host = parts.host,
              host.hasSuffix(".supabase.co"), parts.user == nil,
              parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { return nil }
        return parts.url
    }

    var valid: Bool {
        url != nil && publishableKey.range(of: "^sb_publishable_[A-Za-z0-9_-]+$", options: .regularExpression) != nil &&
            roomID.range(of: "^[A-Za-z0-9-]{3,64}$", options: .regularExpression) != nil
    }
}

struct BroadcastDiagnostics: Codable {
    var version = "0.3.1"
    var updatedAt = Date().timeIntervalSince1970
    var room = ""
    var sessionID = ""
    var state = "방송 시작 대기"
    var ice = "new"
    var framesSubmitted = 0
    var lastError = ""
}

struct ProbeStats: Codable {
    var session = UUID().uuidString
    var state = "대기"
    var updatedAt = Date().timeIntervalSince1970
    var elapsed = 0.0
    var captureFPS = 0.0
    var videoSamples = 0
    var appAudioSamples = 0
    var micAudioSamples = 0
    var sourceWidth = 0
    var sourceHeight = 0
    var previewWidth = 0
    var previewHeight = 0
    var sentFrames = 0
    var busyDrops = 0
    var networkErrors = 0
    var lastError = ""
}

enum ProbeShared {
    static let configName = "probe-config.json"
    static let p2pConfigName = "p2p-broadcast-config.json"
    static let statsName = "probe-stats.json"
    static let diagnosticsName = "screen-diagnostics-v031.json"
    // AltStore may rewrite App Group identifiers. Prefer the actual profile's
    // entitlements, not a hard-coded Team ID. A profile is NOT proof that access works.
    static func groupCandidates() -> [String] {
        var result: [String] = []
        if let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
           let data = try? Data(contentsOf: profile),
           let start = data.range(of: Data("<?xml".utf8)),
           let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
           let plist = try? PropertyListSerialization.propertyList(
               from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil),
           let dictionary = plist as? [String: Any],
           let rights = dictionary["Entitlements"] as? [String: Any],
           let groups = rights["com.apple.security.application-groups"] as? [String] {
            result.append(contentsOf: groups.filter { $0.lowercased().contains("solaris") })
        }
        if let hint = Bundle.main.object(forInfoDictionaryKey: "SolarisAppGroup") as? String,
           !result.contains(hint) { result.append(hint) }
        return result
    }

    static func group() -> (id: String, url: URL)? {
        for id in groupCandidates() {
            if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) {
                return (id, url)
            }
        }
        return nil
    }

    static func write<T: Encodable>(_ value: T, name: String, directory: URL) throws {
        let data = try JSONEncoder().encode(value)
        try data.write(to: directory.appendingPathComponent(name), options: .atomic)
    }

    static func read<T: Decodable>(_ type: T.Type, name: String, directory: URL) throws -> T {
        try JSONDecoder().decode(type, from: Data(contentsOf: directory.appendingPathComponent(name)))
    }

    static func extensionID() -> String? {
        guard let folder = Bundle.main.builtInPlugInsURL,
              let urls = try? FileManager.default.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: nil) else { return nil }
        return urls.first(where: { $0.pathExtension == "appex" }).flatMap { Bundle(url: $0)?.bundleIdentifier }
    }
}
