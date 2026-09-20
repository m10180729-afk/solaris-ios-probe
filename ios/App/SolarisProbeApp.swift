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
    private var config: P2PBroadcastConfig? {
        guard let bundle = ProbeShared.broadcastBundle() else { return nil }
        return ProbeShared.embeddedP2PConfig(in: bundle)
    }
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Solaris \(ProbeShared.appVersion)").font(.title2.bold())
                    Text("아이패드 ↔ Windows 화면공유")
                    Text("iPad 송출 1920급·60fps / Windows 송출 1080p120 목표 · 화면 소리 포함 · 마이크 전송 안 함")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let c = config {
                    Section("Windows → iPad · 1080p120") {
                        NavigationLink("Windows 화면 받기") {
                            DesktopReceiverView(config: c)
                        }
                        Text("Windows 송신 또는 다른 Windows 수신은 Solaris-Desktop-Share-build34.html에서 시작합니다.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section("화면 품질") {
                    Text("Windows에서 품질을 선택하고 ‘품질 저장 / 방송에 적용’을 누르세요.")
                    Text("‘송신기 적용 확인’이 표시되어야 설정이 전달된 것입니다. 이전 iPad 선택기는 App Group 없이 방송 확장에 전달을 보장할 수 없어 제거했습니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Text("기본값은 ReplayKit 입력 원본 해상도 · 최대 60fps입니다. 60fps와 기기 화면의 전체 픽셀 수가 보장되는 것은 아닙니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("1 · Windows에 입력할 방송 설정") {
                    if let c = config {
                        Text(c.projectURL).textSelection(.enabled)
                        Text("방 ID: \(c.roomID)").textSelection(.enabled)
                        Button("Publishable key 복사") { UIPasteboard.general.string = c.publishableKey }
                        Text("이 버전은 앱에 포함된 설정을 사용합니다. Windows에 같은 값을 입력하세요.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Text("방송 확장 또는 포함된 설정을 읽을 수 없습니다. 확장을 포함해 다시 설치하세요.")
                            .foregroundStyle(.orange)
                    }
                }
                Section("2 · Windows 수신 시작 후 방송 시작") {
                    Text("Windows에서 Solaris-Windows-0.3.2-build34.html을 열고 ‘설정 저장 + 수신 시작’을 누르세요.")
                    if config != nil, ProbeShared.extensionID() != nil {
                        Text("아래 버튼 → Solaris 화면 시험 → 공유 시작")
                        BroadcastPicker().frame(width: 60, height: 60)
                    }
                    Text("Windows의 영상 프레임과 화면 소리 RTP 바이트가 증가해야 성공입니다.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("3 · 연결 상태 확인") {
                    Text("방송 진행 상태는 Windows 수신기에서 확인하세요. 이 버전은 앱과 방송 확장 사이에 진단 파일을 공유하지 않습니다.")
                    Button(copied ? "설치 정보 복사됨" : "설치 정보 복사 (키 제외)") {
                        UIPasteboard.general.string = "Solaris app \(ProbeShared.appVersion)\n" +
                            "extension=\(ProbeShared.extensionID() ?? "missing")\n" +
                            "room=\(config?.roomID ?? "missing")\n" +
                            "Configuration: extension bundle. Runtime shared diagnostics: not used.\n" +
                            "Installation metadata does not prove capture or WebRTC connection."
                        copied = true
                    }
                }
            }
            .navigationTitle("Solaris")
        }
    }
}
