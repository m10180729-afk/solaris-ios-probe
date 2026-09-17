import SwiftUI
import ReplayKit

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
        picker.showsMicrophoneButton = false
        return picker
    }
    func updateUIView(_ view: RPSystemBroadcastPickerView, context: Context) {}
}

struct ProbeView: View {
    @State private var projectURL = ""
    @State private var key = ""
    @State private var room = "solaris-screen-31"
    @State private var savedConfig: P2PBroadcastConfig?
    @State private var message = "Windows와 같은 URL, Publishable key, 방 ID를 입력하고 저장하세요."
    @State private var groupStatus = "확인 중"
    @State private var diagnostics: BroadcastDiagnostics?
    @State private var stats: ProbeStats?
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var currentConfig: P2PBroadcastConfig {
        P2PBroadcastConfig(projectURL: projectURL.trimmingCharacters(in: .whitespacesAndNewlines),
                           publishableKey: key.trimmingCharacters(in: .whitespacesAndNewlines),
                           roomID: room.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    private var ready: Bool {
        guard let savedConfig else { return false }
        let c = currentConfig
        return c.valid && c.projectURL == savedConfig.projectURL &&
            c.publishableKey == savedConfig.publishableKey && c.roomID == savedConfig.roomID
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Solaris 0.3.1").font(.title2.bold())
                    Text("아이패드 화면 → Windows · 자동 진단")
                    Text("긴 변 최대 1280px · 최대 15fps 목표 · 음성 없음")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("1 · 화면 방송 설정") {
                    TextField("https://xxxx.supabase.co", text: $projectURL)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("sb_publishable_...", text: $key)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("방 ID", text: $room)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("방송 설정 저장") { save() }
                    Text(message).font(.footnote)
                }
                Section("2 · Windows 수신 시작 후 방송 시작") {
                    Text("Windows에서 Solaris-Windows-0.3.1.html을 열고 ‘설정 저장 + 수신 시작’을 누르세요.")
                        .font(.callout)
                    if ready, ProbeShared.extensionID() != nil {
                        Text("아래 버튼 → Solaris 화면 시험 → 방송 시작")
                        BroadcastPicker().frame(width: 60, height: 60)
                    } else {
                        Text("설정을 저장하면 방송 버튼이 표시됩니다.").foregroundStyle(.secondary)
                    }
                    Text("방송 중 설정을 바꿨다면 방송을 중단한 뒤 다시 시작하세요. 별도 P2P 테스트 화면은 필요 없습니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("3 · 자동 진단") {
                    if let d = diagnostics {
                        let stale = Date().timeIntervalSince1970 - d.updatedAt > 5
                        Text("\(d.state)\(stale ? " · 최근 기록 없음" : "")")
                        Text("방: \(d.room) · ICE: \(d.ice)")
                        Text("캡처 → WebRTC 입력: \(d.framesSubmitted)프레임")
                        if !d.lastError.isEmpty { Text(d.lastError).foregroundStyle(.orange) }
                    } else {
                        Text("방송 시작 후 자동 표시됩니다. 방송 중에도 기록이 없다면 확장 실행 또는 공유 저장소 확인이 필요합니다.")
                    }
                    Text("최종 성공 여부는 Windows의 ‘영상 수신’과 ‘화면 재생’으로 확인합니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("진단 한 번에 복사 (키 제외)") { copyDiagnostics() }
                }
                Section {
                    DisclosureGroup("설치·확장 세부 정보") {
                        Text(groupStatus).font(.footnote).textSelection(.enabled)
                        Text("확장: \(ProbeShared.extensionID() ?? "없음 — 확장을 포함해 다시 설치하세요")")
                            .font(.footnote).textSelection(.enabled)
                        if let s = stats {
                            Text("확장 상태: \(s.state) · 캡처 콜백: \(s.videoSamples)")
                            Text("원본: \(s.sourceWidth)×\(s.sourceHeight)")
                            if !s.lastError.isEmpty { Text(s.lastError).foregroundStyle(.orange) }
                        }
                    }
                }
            }
            .navigationTitle("Solaris")
            .onAppear { load() }
            .onReceive(timer) { _ in refresh() }
        }
    }
    private func load() {
        guard let group = ProbeShared.group() else {
            groupStatus = "App Group 접근 실패: 앱과 방송 확장의 재서명 권한을 확인하세요."
            return
        }
        groupStatus = "앱이 연 공유 그룹: \(group.id)"
        if savedConfig == nil,
           let c = try? ProbeShared.read(P2PBroadcastConfig.self, name: ProbeShared.p2pConfigName, directory: group.url) {
            projectURL = c.projectURL; key = c.publishableKey; room = c.roomID; savedConfig = c
        }
        refresh()
    }
    private func save() {
        guard let group = ProbeShared.group() else { message = "공유 저장소 접근 실패"; return }
        let c = currentConfig
        guard c.valid else { message = "Project URL, Publishable key, 영문·숫자·하이픈 방 ID(3~64자)를 확인하세요."; return }
        do {
            try ProbeShared.write(c, name: ProbeShared.p2pConfigName, directory: group.url)
            let check = try ProbeShared.read(P2PBroadcastConfig.self, name: ProbeShared.p2pConfigName, directory: group.url)
            guard check.projectURL == c.projectURL, check.publishableKey == c.publishableKey, check.roomID == c.roomID else {
                throw CocoaError(.fileReadCorruptFile)
            }
            savedConfig = c
            message = "저장 확인 완료. Windows 수신 시작 → 아래 방송 시작 순서로 진행하세요."
        } catch { savedConfig = nil; message = "저장 실패: \(error.localizedDescription)" }
    }
    private func refresh() {
        guard let group = ProbeShared.group() else { return }
        diagnostics = try? ProbeShared.read(BroadcastDiagnostics.self, name: ProbeShared.diagnosticsName, directory: group.url)
        stats = try? ProbeShared.read(ProbeStats.self, name: ProbeShared.statsName, directory: group.url)
    }
    private func copyDiagnostics() {
        var report = "Solaris app 0.3.1\n\(groupStatus)\nextension=\(ProbeShared.extensionID() ?? "missing")"
        if let d = diagnostics, let data = try? JSONEncoder().encode(d), let text = String(data: data, encoding: .utf8) {
            report += "\n" + text
        } else { report += "\nBroadcast diagnostics missing" }
        if let s = stats { report += "\nCapture callbacks=\(s.videoSamples) state=\(s.state) error=\(s.lastError)" }
        UIPasteboard.general.string = report
    }
}
