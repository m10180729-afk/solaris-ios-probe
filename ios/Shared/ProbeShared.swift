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

struct ScreenQuality: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let maxLongSide: Int
    let fps: Int

    static let automatic = ScreenQuality(id: "auto", title: "자동", maxLongSide: 1280, fps: 30)
    // The ReplayKit extension cannot reliably read host-app UserDefaults when
    // installed through free AltStore signing. Use the highest native-preserving
    // preset as the extension fallback instead of silently reverting to 1280p.
    static let extensionDefault = ScreenQuality(id: "1440p60", title: "QHD · 60fps", maxLongSide: 2560, fps: 60)
    static let presets = [
        automatic,
        ScreenQuality(id: "720p30", title: "720p · 30fps", maxLongSide: 1280, fps: 30),
        ScreenQuality(id: "1080p30", title: "1080p · 30fps", maxLongSide: 1920, fps: 30),
        ScreenQuality(id: "1080p60", title: "1080p · 60fps", maxLongSide: 1920, fps: 60),
        ScreenQuality(id: "1440p30", title: "QHD · 30fps", maxLongSide: 2560, fps: 30),
        ScreenQuality(id: "1440p60", title: "QHD · 60fps", maxLongSide: 2560, fps: 60)
    ]

    static func current() -> ScreenQuality {
        let id = UserDefaults(suiteName: ProbeShared.settingsSuite)?.string(forKey: ProbeShared.qualityKey)
        return presets.first(where: { $0.id == id }) ?? extensionDefault
    }

    // The Broadcast Upload Extension must not fall back to the host app's
    // "automatic" 1280x30 preset.  Under AltStore/free signing the shared
    // defaults can be missing or stale, so the extension treats auto/unknown
    // as native-preserving high quality instead.
    static func extensionCurrent() -> ScreenQuality {
        let id = UserDefaults(suiteName: ProbeShared.settingsSuite)?.string(forKey: ProbeShared.qualityKey)
        guard let id, id != automatic.id,
              let selected = presets.first(where: { $0.id == id }) else {
            return extensionDefault
        }
        return selected
    }
}

struct BroadcastDiagnostics: Codable {
    var version = "0.3.2"
    var updatedAt = Date().timeIntervalSince1970
    var room = ""
    var sessionID = ""
    var state = "방송 시작 대기"
    var ice = "new"
    var framesSubmitted = 0
    var sourceWidth = 0
    var sourceHeight = 0
    var outputWidth = 0
    var outputHeight = 0
    var targetFPS = 0
    var inputFPS = 0.0
    var qualityID = ""
    var sourceAspect = ""
    var scaling = ""
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
    static let settingsSuite = "group.org.solaris.probe.GS98RPL583"
    static let qualityKey = "screenQuality"

    static func saveQuality(_ quality: ScreenQuality) {
        UserDefaults(suiteName: settingsSuite)?.set(quality.id, forKey: qualityKey)
    }
    // Bundle configuration avoids any runtime dependency on App Group access.
    // The host reads the embedded extension bundle; the extension reads itself.
    static func embeddedP2PConfig(in bundle: Bundle = .main) -> P2PBroadcastConfig? {
        guard let projectURL = bundle.object(forInfoDictionaryKey: "SolarisP2PProjectURL") as? String,
              let publishableKey = bundle.object(forInfoDictionaryKey: "SolarisP2PPublishableKey") as? String,
              let roomID = bundle.object(forInfoDictionaryKey: "SolarisP2PRoomID") as? String else { return nil }
        let config = P2PBroadcastConfig(projectURL: projectURL, publishableKey: publishableKey, roomID: roomID)
        return config.valid ? config : nil
    }
    static var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        return "\(version) (build \(build))"
    }
    static let configName = "probe-config.json"
    static let p2pConfigName = "p2p-broadcast-config.json"
    static let statsName = "probe-stats.json"
    static let diagnosticsName = "screen-diagnostics-v031.json"
    // AltStore may rewrite App Group identifiers. Prefer the actual profile's
    // entitlements, not a hard-coded Team ID. A profile is NOT proof that access works.
    static func groupCandidates() -> [String] {
        var result = profileGroups(in: .main).filter { $0.lowercased().contains("solaris") }
        if let hint = Bundle.main.object(forInfoDictionaryKey: "SolarisAppGroup") as? String,
           !result.contains(hint) { result.append(hint) }
        return result
    }

    // Profile metadata is useful evidence, NOT proof of runtime container access.
    static func profileGroups(in bundle: Bundle) -> [String] {
        if let profile = bundle.url(forResource: "embedded", withExtension: "mobileprovision"),
           let data = try? Data(contentsOf: profile),
           let start = data.range(of: Data("<?xml".utf8)),
           let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
           let plist = try? PropertyListSerialization.propertyList(
               from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil),
           let dictionary = plist as? [String: Any],
           let rights = dictionary["Entitlements"] as? [String: Any],
           let groups = rights["com.apple.security.application-groups"] as? [String] {
            return groups
        }
        return []
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
        broadcastBundle()?.bundleIdentifier
    }

    static func broadcastBundle() -> Bundle? {
        guard let folder = Bundle.main.builtInPlugInsURL,
              let urls = try? FileManager.default.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: nil) else { return nil }
        return urls.compactMap { Bundle(url: $0) }.first {
            ($0.object(forInfoDictionaryKey: "NSExtension") as? [String: Any])?["NSExtensionPointIdentifier"] as? String
                == "com.apple.broadcast-services-upload"
        }
    }

    static func extensionReport() -> String {
        guard let bundle = broadcastBundle() else { return "Broadcast extension missing" }
        let ext = bundle.object(forInfoDictionaryKey: "NSExtension") as? [String: Any] ?? [:]
        let mode = ext["RPBroadcastProcessMode"] as? String ?? "MISSING / wrong nesting"
        let principal = ext["NSExtensionPrincipalClass"] as? String ?? "MISSING"
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        let appGroups = profileGroups(in: .main)
        let extensionGroups = profileGroups(in: bundle)
        return "extension=\(bundle.bundleIdentifier ?? "missing") version=\(version) build=\(build)\n" +
            "processMode=\(mode)\nprincipalClass=\(principal)\n" +
            "appProfileGroups=\(appGroups)\nextensionProfileGroups=\(extensionGroups)\n" +
            "commonProfileGroups=\(appGroups.filter { extensionGroups.contains($0) })\n" +
            "Profile metadata does not prove extension runtime access."
    }
}
