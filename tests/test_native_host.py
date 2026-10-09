from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class NativeHostTests(unittest.TestCase):
    def setUp(self):
        self.program = (ROOT / "windows-native/SolarisNativeHost/Program.cs").read_text()
        self.form = (ROOT / "windows-native/SolarisNativeHost/MainForm.cs").read_text()
        self.project = (ROOT / "windows-native/SolarisNativeHost/SolarisNativeHost.csproj").read_text()
        self.workflow = (ROOT / ".github/workflows/build-ios-probe.yml").read_text()
        self.html = (ROOT / "ios/App/Resources/solaris-desktop.html").read_text()

    def test_has_no_apollo_or_moonlight_build_dependency(self):
        self.assertNotIn("ClassicOldSong/Apollo", self.workflow)
        self.assertNotIn("moonlight-stream/moonlight-ios", self.workflow)
        self.assertNotIn("Solaris-Native-Receiver", self.workflow)
        self.assertNotIn("sunshine.exe", self.program + self.form)

    def test_embeds_sender_in_solaris_executable(self):
        self.assertIn("Microsoft.Web.WebView2", self.project)
        self.assertIn("EmbeddedResource", self.project)
        self.assertIn("SetVirtualHostNameToFolderMapping", self.form)
        self.assertIn("https://solaris.local/solaris-desktop.html", self.form)

    def test_hardware_path_and_fallback_exist(self):
        self.assertIn("native-start", self.html)
        self.assertIn("sharedbufferreceived", self.html)
        self.assertIn("NativeH264Capture", (ROOT / "windows-native/SolarisNativeHost/NativeH264Capture.cs").read_text())
        self.assertIn("webcodecs-h264", self.html)
        self.assertIn("compatibility60", self.html)

    def test_windows_action_builds_and_runs_self_test(self):
        self.assertIn("runs-on: windows-2025", self.workflow)
        self.assertIn("dotnet publish", self.workflow)
        self.assertIn("SolarisNativeHost.exe --self-test", self.workflow)
        self.assertIn("Solaris-Windows-Sender-build48", self.workflow)
        self.assertIn("ffmpeg-release-essentials.zip", self.workflow)
        self.assertIn("-force_key_frames", (ROOT / "windows-native/SolarisNativeHost/NativeH264Capture.cs").read_text())
        self.assertIn("BUILD_NUMBER='48'", self.html)
        self.assertIn("dataChannelQueueHighWaterBytes", self.html)


if __name__ == "__main__":
    unittest.main()
