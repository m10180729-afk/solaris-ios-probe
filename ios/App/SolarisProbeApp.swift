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
    @State private var qualityID = ScreenQuality.current().id

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Solaris \(ProbeShared.appVersion)").font(.title2.bold())
                    Text("아이패드 화면 → Windows")
                    Text("화면 품질은 아래 설정에서 선택 · 음성 없음")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("화면 품질") {
                    Picker("송출 품질", selection: $qualityID) {
                        ForEach(ScreenQuality.presets) { quality in
                            Text(quality.title).tag(quality.id)
                        }
                    }
                    .onChange(of: qualityID) { value in
                        if let quality = ScreenQuality.presets.first(where: { $0.id == value }) {
                            ProbeShared.saveQuality(quality)
                        }
                    }
                    Text("QHD·60fps는 iPad 성능과 네트워크에 따라 실제 프레임이 낮아질 수 있습니다.")
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
                    Text("Windows에서 Solaris-Windows-0.3.2.html을 열고 ‘설정 저장 + 수신 시작’을 누르세요.")
                    if config != nil, ProbeShared.extensionID() != nil {
                        Text("아래 버튼 → Solaris 화면 시험 → 공유 시작")
                        BroadcastPicker().frame(width: 60, height: 60)
                    }
                    Text("Windows의 영상 프레임이 증가하고 실제 화면이 표시되어야 성공입니다.")
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
