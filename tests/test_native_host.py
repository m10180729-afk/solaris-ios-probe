from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class NativeHostTests(unittest.TestCase):
    def setUp(self):
        self.program = (ROOT / "windows-native/SolarisNativeHost/Program.cs").read_text()
        self.form = (ROOT / "windows-native/SolarisNativeHost/MainForm.cs").read_text()
        self.workflow = (ROOT / ".github/workflows/build-ios-probe.yml").read_text()

    def test_uses_bundled_engine_without_separate_install(self):
        self.assertNotIn("winget.exe", self.program)
        self.assertNotIn("InstallOrUpdate", self.program)
        self.assertIn('Path.Combine(AppContext.BaseDirectory, "engine")', self.program)
        self.assertIn("FindBundledEngine", self.program)
        self.assertNotIn("WebClient", self.program)
        self.assertNotIn("DownloadFile", self.program)

    def test_registers_native_protocol_and_diagnoses_hardware(self):
        self.assertIn("Software\\Classes\\solaris-native", self.program)
        self.assertIn("Win32_VideoController", self.program)
        self.assertIn("CurrentRefreshRate", self.program)
        self.assertIn("NVIDIA", self.program)
        self.assertIn("Radeon", self.program)
        self.assertIn("Intel", self.program)

    def test_does_not_claim_hardware_encoder_before_stream_test(self):
        self.assertIn("실제 NVENC/Quick Sync/AMF 사용 여부", self.form)
        self.assertIn("수신 통계와 Solaris 엔진 로그로 최종 확인", self.form)

    def test_action_pins_and_bundles_official_gpl_engine(self):
        self.assertIn("ClassicOldSong/Apollo/releases/tags/$tag", self.workflow)
        self.assertIn("$tag = 'v0.4.6'", self.workflow)
        self.assertIn("dist/native/engine", self.workflow)
        self.assertIn("APOLLO_GPLv3_LICENSE.txt", self.workflow)
        self.assertIn("THIRD_PARTY_APOLLO.txt", self.workflow)

    def test_windows_action_builds_and_runs_self_test(self):
        self.assertIn("runs-on: windows-2025", self.workflow)
        self.assertIn("dotnet publish", self.workflow)
        self.assertIn("SolarisNativeHost.exe --self-test", self.workflow)
        self.assertIn("Solaris-Native-Host-build39-portable", self.workflow)

    def test_builds_solaris_branded_native_ios_receiver(self):
        self.assertIn("moonlight-stream/moonlight-ios.git", self.workflow)
        self.assertIn("Solaris-Native-Receiver-build39-resign.ipa", self.workflow)
        self.assertIn("com.solaris.native.receiver", self.workflow)
        self.assertIn("MOONLIGHT_GPLv3_LICENSE.txt", self.workflow)


if __name__ == "__main__":
    unittest.main()
