import SwiftUI
import ReplayKit
import AVFoundation
import WebKit

@main
struct SolarisProbeApp: App {
    var body: some Scene {
        WindowGroup { ProbeView().preferredColorScheme(.dark) }
    }
}

struct BroadcastPicker: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 60, height: 60))
        picker.preferredExtension = ProbeShared.extensionID()
        picker.showsMicrophoneButton = true
        picker.tintColor = .white
        return picker
    }
    func updateUIView(_ view: RPSystemBroadcastPickerView, context: Context) {}
}

struct ProbeView: View {
    @State private var endpoint = "http://192.168.0.10:8765"
    @State private var token = ""
    @State private var message = "PC 수신기를 실행하고 주소·임시 토큰을 입력하세요."
    @State private var groupStatus = "확인 중"
    @State private var armed = false
    @State private var stats: ProbeStats?
    @State private var p2pURL = ""
    @State private var p2pKey = ""
    @State private var p2pRoom = "solaris-test-3"
    @State private var p2pMessage = "WebRTC 방송 설정을 저장하세요."
    @State private var p2pArmed = false
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        if let logo = UIImage(named: "SolarisMark.jpeg") {
                            Image(uiImage: logo).resizable().scaledToFit()
                                .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        VStack(alignment: .leading) {
                            Text("Solaris Probe").font(.title2.bold())
                            Text("1A · 설치와 화면 캡처 시험").foregroundStyle(.secondary)
                        }
                    }
                    Text("시험 미리보기: 긴 변 720px · 최대 5fps · 음성 전송 없음. 1080p60 성능 시험이 아닙니다.")
                        .font(.callout).foregroundStyle(.orange)
                }
                Section("2A · P2P WebRTC 연결 검증") {
                    Text("Supabase 무료 신호 서버로 iPad와 Windows 브라우저가 WebRTC DataChannel을 직접 연결하는지 시험합니다. 화면공유 전송은 다음 단계입니다.")
                        .font(.callout)
                    NavigationLink("P2P 연결 테스트 열기") {
                        P2PProbeView()
                    }
                }
                Section("3A · 인터넷 화면공유 송신") {
                    TextField("https://xxxx.supabase.co", text: $p2pURL)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("sb_publishable_...", text: $p2pKey)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("방 ID", text: $p2pRoom)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("WebRTC 방송 설정 저장") { saveP2PBroadcastConfig() }
                    Text(p2pMessage).font(.footnote)
                    Text("Windows는 같은 값으로 caller를 시작한 뒤 Apple 방송 버튼에서 Solaris 화면 시험을 선택하세요.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("서명·확장 진단") {
                    Text(groupStatus).font(.footnote).textSelection(.enabled)
                    Text("확장: \(ProbeShared.extensionID() ?? "없음 — 확장을 포함해 다시 빌드/설치하세요")")
                        .font(.footnote).textSelection(.enabled)
                }
                Section("같은 Wi-Fi의 Windows PC") {
                    TextField("http://PC의 사설IP:8765", text: $endpoint)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("수신기에 표시된 64자리 임시 토큰", text: $token)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("설정 저장 · PC 연결 확인") { saveAndCheck() }
                    Text(message).font(.footnote)
                }
                Section("방송 시작/종료") {
                    Text("연결 확인 후 아래 Apple 방송 버튼을 직접 누르세요. 종료도 같은 버튼이나 시스템 녹화 표시에서 할 수 있습니다.")
                        .font(.callout)
                    if (armed || p2pArmed), ProbeShared.extensionID() != nil {
                        BroadcastPicker().frame(width: 60, height: 60)
                    }
                    Text("다른 앱으로 이동해 시험하세요. 알림·비밀번호·개인정보도 보일 수 있으니 집중 모드를 켜고 민감한 앱은 열지 마세요.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let s = stats {
                    Section("확장 상태 · 앱으로 돌아오면 갱신") {
                        let stale = Date().timeIntervalSince1970 - s.updatedAt > 5
                        Text("\(s.state)\(stale ? " · 최근 기록 없음" : "")")
                        Text(String(format: "경과 %.0f초 · 캡처 콜백 %.1ffps", s.elapsed, s.captureFPS))
                        Text("원본 \(s.sourceWidth)×\(s.sourceHeight) · 미리보기 \(s.previewWidth)×\(s.previewHeight)")
                        Text("캡처 \(s.videoSamples) · 전송 \(s.sentFrames) · 통신 오류 \(s.networkErrors)")
                        Text("오디오 샘플: 앱 \(s.appAudioSamples) / 마이크 \(s.micAudioSamples) — 소리는 전송하지 않음")
                        if !s.lastError.isEmpty { Text(s.lastError).foregroundStyle(.orange) }
                    }
                }
            }
            .navigationTitle("Solaris")
            .onAppear { inspect() }
            .onReceive(timer) { _ in refresh() }
            .onChange(of: endpoint) { _ in armed = false }
            .onChange(of: token) { _ in armed = false }
        }
    }

    private func inspect() {
        guard let group = ProbeShared.group() else {
            groupStatus = "App Group 없음: 무료 서명 권한 또는 재서명 결과를 점검해야 합니다."
            return
        }
        groupStatus = "App Group 후보: \(group.id) — 설정 저장과 확장 읽기로 확인합니다."
        if let config = try? ProbeShared.read(ProbeConfig.self, name: ProbeShared.configName, directory: group.url) {
            endpoint = config.endpoint
            token = config.token
        }
        if let p2p = try? ProbeShared.read(P2PBroadcastConfig.self,
                                           name: ProbeShared.p2pConfigName,
                                           directory: group.url) {
            p2pURL = p2p.projectURL
            p2pKey = p2p.publishableKey
            p2pRoom = p2p.roomID
            p2pArmed = p2p.valid
        }
        refresh()
    }

    private func saveP2PBroadcastConfig() {
        guard let group = ProbeShared.group() else {
            p2pMessage = "App Group을 열 수 없습니다."
            return
        }
        let value = P2PBroadcastConfig(
            projectURL: p2pURL.trimmingCharacters(in: .whitespacesAndNewlines),
            publishableKey: p2pKey.trimmingCharacters(in: .whitespacesAndNewlines),
            roomID: p2pRoom.trimmingCharacters(in: .whitespacesAndNewlines))
        guard value.valid else {
            p2pArmed = false
            p2pMessage = "Project URL, Publishable key, 방 ID를 확인하세요."
            return
        }
        do {
            try ProbeShared.write(value, name: ProbeShared.p2pConfigName, directory: group.url)
            p2pArmed = true
            p2pMessage = "저장 완료. Windows caller를 먼저 시작한 뒤 방송을 시작하세요."
        } catch {
            p2pArmed = false
            p2pMessage = "저장 실패: \(error.localizedDescription)"
        }
    }

    private func refresh() {
        if let group = ProbeShared.group() {
            stats = try? ProbeShared.read(ProbeStats.self, name: ProbeShared.statsName, directory: group.url)
        }
    }

    private func saveAndCheck() {
        armed = false
        let config = ProbeConfig(endpoint: endpoint.trimmingCharacters(in: .whitespacesAndNewlines),
                                 token: token.trimmingCharacters(in: .whitespacesAndNewlines))
        guard config.valid, let url = config.url, let group = ProbeShared.group() else {
            message = "사설 IPv4 주소·포트·64자리 소문자 토큰·App Group을 확인하세요."
            return
        }
        do {
            try ProbeShared.write(config, name: ProbeShared.configName, directory: group.url)
            let check = try ProbeShared.read(ProbeConfig.self, name: ProbeShared.configName, directory: group.url)
            guard check.token == config.token else { throw CocoaError(.fileReadCorruptFile) }
            groupStatus = "앱의 App Group 읽기/쓰기 성공: \(group.id)"
        } catch {
            message = "설정 저장 실패: \(error.localizedDescription)"
            return
        }
        message = "PC 연결 확인 중… 로컬 네트워크 권한을 허용하세요."
        var request = URLRequest(url: url.appendingPathComponent("ping"))
        request.timeoutInterval = 8
        request.setValue(config.token, forHTTPHeaderField: "X-Solaris-Token")
        let settings = URLSessionConfiguration.ephemeral
        settings.urlCache = nil
        settings.httpCookieStorage = nil
        settings.connectionProxyDictionary = [:]
        let session = URLSession(configuration: settings, delegate: ProbeLANDelegate(), delegateQueue: nil)
        session.dataTask(with: request) { _, response, error in
            session.finishTasksAndInvalidate()
            DispatchQueue.main.async {
                guard endpoint.trimmingCharacters(in: .whitespacesAndNewlines) == config.endpoint,
                      token.trimmingCharacters(in: .whitespacesAndNewlines) == config.token else { return }
                let ok = (response as? HTTPURLResponse)?.statusCode == 200
                armed = ok && error == nil
                message = armed ? "PC 연결 성공. 방송 버튼으로 시작하세요."
                    : "연결 실패: Wi-Fi·주소·토큰·로컬 네트워크 권한·Windows 개인 네트워크 방화벽을 확인하세요."
            }
        }.resume()
    }
}

struct P2PProbeView: View {
    var body: some View {
        Group {
            if let url = Bundle.main.url(forResource: "solaris-p2p", withExtension: "html") {
                P2PWebView(url: url)
            } else {
                Text("P2P 테스트 파일을 찾을 수 없습니다. 앱을 다시 빌드하세요.")
                    .foregroundStyle(.orange)
                    .padding()
            }
        }
        .navigationTitle("Solaris P2P")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct P2PWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        if #available(iOS 14.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }
        let view = WKWebView(frame: .zero, configuration: config)
        if #available(iOS 16.4, *) {
            view.isInspectable = true
        }
        view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}
