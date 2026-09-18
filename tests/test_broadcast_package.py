"""Regression: invalid ReplayKit mode nesting must fail before an IPA ships."""
import copy
import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_project", ROOT / "scripts/check_project.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


class BroadcastPackageTests(unittest.TestCase):
    def setUp(self):
        self.info = plistlib.loads((ROOT / "ios/Broadcast/Info.plist").read_bytes())

    def test_source_mode(self):
        checks.check_broadcast_info(self.info, "$(PRODUCT_MODULE_NAME).SampleHandler")

    def test_old_nested_mode_rejected(self):
        ext = self.info["NSExtension"]
        mode = ext.pop("RPBroadcastProcessMode")
        ext["NSExtensionAttributes"] = {"RPBroadcastProcessMode": mode}
        with self.assertRaisesRegex(AssertionError, "directly inside"):
            checks.check_broadcast_info(self.info, "$(PRODUCT_MODULE_NAME).SampleHandler")

    def test_missing_mode_rejected(self):
        self.info["NSExtension"].pop("RPBroadcastProcessMode")
        with self.assertRaises(AssertionError):
            checks.check_broadcast_info(self.info, "$(PRODUCT_MODULE_NAME).SampleHandler")

    def test_movie_mode_rejected(self):
        self.info["NSExtension"]["RPBroadcastProcessMode"] = "RPBroadcastProcessModeMovieClip"
        with self.assertRaises(AssertionError):
            checks.check_broadcast_info(self.info, "$(PRODUCT_MODULE_NAME).SampleHandler")

    def test_wrong_principal_rejected(self):
        with self.assertRaises(AssertionError):
            checks.check_broadcast_info(self.info, "WrongModule.SampleHandler")

    def make_ipa(self, destination, nested=False, mismatch=False, missing_framework=False, duplicate=False):
        # Minimal fixture: checks bundle metadata and headers, not a runnable IPA.
        app = {"CFBundleIdentifier": "org.solaris.probe", "CFBundleShortVersionString": "0.3.2",
               "CFBundleVersion": "5", "CFBundleExecutable": "SolarisProbe"}
        ext = copy.deepcopy(app)
        ext.update(CFBundleIdentifier="org.solaris.probe.broadcast", CFBundleExecutable="SolarisBroadcast")
        ext["NSExtension"] = copy.deepcopy(self.info["NSExtension"])
        ext["NSExtension"]["NSExtensionPrincipalClass"] = "SolarisBroadcast.SampleHandler"
        if nested:
            value = ext["NSExtension"].pop("RPBroadcastProcessMode")
            ext["NSExtension"]["NSExtensionAttributes"] = {"RPBroadcastProcessMode": value}
        if mismatch:
            ext["CFBundleVersion"] = "4"
        with zipfile.ZipFile(destination, "w") as archive:
            for folder, info in (("Payload/SolarisProbe.app/", app),
                ("Payload/SolarisProbe.app/PlugIns/SolarisBroadcast.appex/", ext)):
                archive.writestr(folder + "Info.plist", plistlib.dumps(info))
                archive.writestr(folder + info["CFBundleExecutable"], b"\xcf\xfa\xed\xfe" + bytes(32))
            if not missing_framework:
                roots = ["Payload/SolarisProbe.app/PlugIns/SolarisBroadcast.appex/Frameworks/WebRTC.framework/"]
                if duplicate:
                    roots.append("Payload/SolarisProbe.app/Frameworks/WebRTC.framework/")
                for root in roots:
                    archive.writestr(root + "Info.plist", plistlib.dumps({
                        "CFBundleExecutable": "WebRTC", "CFBundleSupportedPlatforms": ["iPhoneOS"]}))
                    archive.writestr(root + "WebRTC", b"\xcf\xfa\xed\xfe" + bytes(32))

    def test_built_ipa_mode(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.ipa"
            self.make_ipa(path)
            checks.check_ipa(path)

    def test_built_ipa_old_nesting_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.ipa"
            self.make_ipa(path, nested=True)
            with self.assertRaisesRegex(AssertionError, "directly inside"):
                checks.check_ipa(path)

    def test_mixed_builds_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.ipa"
            self.make_ipa(path, mismatch=True)
            with self.assertRaises(AssertionError):
                checks.check_ipa(path)

    def test_missing_extension_framework_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.ipa"
            self.make_ipa(path, missing_framework=True)
            with self.assertRaisesRegex(AssertionError, "Missing extension"):
                checks.check_ipa(path)

    def test_duplicate_host_framework_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.ipa"
            self.make_ipa(path, duplicate=True)
            with self.assertRaisesRegex(AssertionError, "Duplicate host"):
                checks.check_ipa(path)


if __name__ == "__main__":
    unittest.main()
