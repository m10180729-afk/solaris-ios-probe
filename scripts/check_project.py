"""Dependency-free source/IPA structure checks, NOT an iOS compiler or signing test."""
import argparse
import ast
from pathlib import Path
import plistlib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
GROUP = "group.org.solaris.probe"


def check_sources():
    for path in sorted(ROOT.rglob("*.py")):
        if not {"build", "dist", "__pycache__", "node_modules"}.intersection(path.relative_to(ROOT).parts):
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for name in ("App", "Broadcast"):
        info = plistlib.loads((ROOT / f"ios/{name}/Info.plist").read_bytes())
        assert info["SolarisAppGroup"] == GROUP
        assert info["NSLocalNetworkUsageDescription"]
        assert info["NSAppTransportSecurity"]["NSAllowsArbitraryLoads"] is True
    extension = plistlib.loads((ROOT / "ios/Broadcast/Info.plist").read_bytes())["NSExtension"]
    assert extension["NSExtensionPointIdentifier"] == "com.apple.broadcast-services-upload"
    assert extension["NSExtensionPrincipalClass"] == "$(PRODUCT_MODULE_NAME).SampleHandler"
    assert extension["NSExtensionAttributes"]["RPBroadcastProcessMode"] == "RPBroadcastProcessModeSampleBuffer"
    rights = plistlib.loads((ROOT / "ios/Config/Probe.entitlements").read_bytes())
    assert rights == {"com.apple.security.application-groups": [GROUP]}
    for path in ("ios/project.yml", "receiver/viewer.html", "tests/ProbeConfigTests.swift",
                 "scripts/build_ios.sh", ".github/workflows/build-ios-probe.yml",
                 "ios/App/Resources/SolarisMark.jpeg",
                 "ios/Broadcast/BroadcastWebRTCSender.swift"):
        assert (ROOT / path).is_file(), path
    project = (ROOT / "ios/project.yml").read_text(encoding="utf-8")
    assert "https://github.com/stasel/WebRTC.git" in project
    assert "exactVersion: 153.0.0" in project
    print("PASS: Python syntax, plist values, App Group consistency, required source files")
    print("NOT VERIFIED: Swift/iOS compilation, entitlements on device, capture, FPS, latency")


def check_ipa(path):
    with zipfile.ZipFile(path) as archive:
        bad = archive.testzip()
        assert bad is None, bad
        app_root = "Payload/SolarisProbe.app/"
        extension_root = app_root + "PlugIns/SolarisBroadcast.appex/"
        app = plistlib.loads(archive.read(app_root + "Info.plist"))
        ext = plistlib.loads(archive.read(extension_root + "Info.plist"))
        assert ext["CFBundleIdentifier"].startswith(app["CFBundleIdentifier"] + ".")
        assert app["CFBundleShortVersionString"] == ext["CFBundleShortVersionString"]
        assert app["CFBundleVersion"] == ext["CFBundleVersion"]
        assert ext["NSExtension"]["NSExtensionPointIdentifier"] == "com.apple.broadcast-services-upload"
        assert ext["NSExtension"]["NSExtensionPrincipalClass"] == "SolarisBroadcast.SampleHandler"
        for folder, info in ((app_root, app), (extension_root, ext)):
            assert not any("$(" in str(value) for value in info.values()), "Unexpanded build setting"
            executable = archive.read(folder + info["CFBundleExecutable"])
            assert executable[:4] in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca")
    print("PASS: IPA container, app/extension bundle relationship, versions, executable headers")
    print("IPA is only a re-signing candidate. Device installation remains unverified.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ipa", type=Path)
    args = parser.parse_args()
    check_sources()
    if args.ipa:
        check_ipa(args.ipa)
