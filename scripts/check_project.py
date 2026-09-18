"""Dependency-free source/IPA structure checks, NOT an iOS compiler or signing test."""
import argparse
import ast
from pathlib import Path
import plistlib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
GROUP = "group.org.solaris.probe"


def check_broadcast_info(info, principal):
    extension = info["NSExtension"]
    assert extension["NSExtensionPointIdentifier"] == "com.apple.broadcast-services-upload"
    assert extension["NSExtensionPrincipalClass"] == principal
    assert extension.get("RPBroadcastProcessMode") == "RPBroadcastProcessModeSampleBuffer", \
        "RPBroadcastProcessMode must be directly inside NSExtension, NOT NSExtensionAttributes"
    assert "RPBroadcastProcessMode" not in extension.get("NSExtensionAttributes", {}), \
        "Remove misplaced RPBroadcastProcessMode"


def check_sources():
    for path in sorted(ROOT.rglob("*.py")):
        if not {"build", "dist", "__pycache__", "node_modules"}.intersection(path.relative_to(ROOT).parts):
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for name in ("App", "Broadcast"):
        info = plistlib.loads((ROOT / f"ios/{name}/Info.plist").read_bytes())
        assert info["NSLocalNetworkUsageDescription"]
        assert info["NSAppTransportSecurity"]["NSAllowsArbitraryLoads"] is True
    broadcast_info = plistlib.loads((ROOT / "ios/Broadcast/Info.plist").read_bytes())
    assert broadcast_info["SolarisP2PProjectURL"].startswith("https://")
    assert broadcast_info["SolarisP2PPublishableKey"].startswith("sb_publishable_")
    assert broadcast_info["SolarisP2PRoomID"] == "solaristest1"
    check_broadcast_info(broadcast_info,
                         "$(PRODUCT_MODULE_NAME).SampleHandler")
    rights = plistlib.loads((ROOT / "ios/Config/Probe.entitlements").read_bytes())
    assert rights == {}, "No-App-Group build must not request shared-container entitlements"
    for path in ("ios/project.yml", "receiver/viewer.html", "tests/ProbeConfigTests.swift",
                 "scripts/build_ios.sh", ".github/workflows/build-ios-probe.yml",
                 "ios/App/Resources/SolarisMark.jpeg",
                 "ios/Broadcast/BroadcastWebRTCSender.swift"):
        assert (ROOT / path).is_file(), path
    project = (ROOT / "ios/project.yml").read_text(encoding="utf-8")
    assert "framework: Vendor/WebRTC.xcframework" in project
    assert "package: WebRTC" not in project, "Do not copy the SPM product name as a framework"
    assert "packages:" not in project, "WebRTC is downloaded with the pinned upstream checksum"
    build_script = (ROOT / "scripts/build_ios.sh").read_text()
    assert "--entitlements" not in build_script, "Do not restore App Group entitlements during packaging"
    assert "import WebRTC" in (ROOT / "ios/Broadcast/BroadcastWebRTCSender.swift").read_text()
    for path in (ROOT / "ios/App").rglob("*.swift"):
        assert "import WebRTC" not in path.read_text(), "Only the broadcast extension uses WebRTC"
    app_source = (ROOT / "ios/App/SolarisProbeApp.swift").read_text()
    assert "ProbeShared.group()" not in app_source, "Broadcast UI must not require App Group storage"
    print("PASS: Python syntax, plist values, no App Group requirement, real XCFramework dependency")
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
        check_broadcast_info(ext, "SolarisBroadcast.SampleHandler")
        for folder, info in ((app_root, app), (extension_root, ext)):
            assert not any("$(" in str(value) for value in info.values()), "Unexpanded build setting"
            executable = archive.read(folder + info["CFBundleExecutable"])
            assert executable[:4] in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca")
        framework_root = extension_root + "Frameworks/WebRTC.framework/"
        names = set(archive.namelist())
        assert framework_root + "WebRTC" in names, "Missing extension Frameworks/WebRTC.framework/WebRTC"
        assert not any(n.startswith(app_root + "Frameworks/WebRTC.framework/") for n in names), "Duplicate host WebRTC framework"
        info = plistlib.loads(archive.read(framework_root + "Info.plist"))
        assert info["CFBundleExecutable"] == "WebRTC"
        assert "iPhoneOS" in info.get("CFBundleSupportedPlatforms", []), "Wrong WebRTC platform"
        assert archive.read(framework_root + "WebRTC")[:4] in (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"), "Invalid WebRTC binary"
    print("PASS: IPA bundles, ReplayKit mode, versions, executables, extension-local WebRTC.framework")
    print("IPA is only a re-signing candidate. Device installation remains unverified.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ipa", type=Path)
    args = parser.parse_args()
    check_sources()
    if args.ipa:
        check_ipa(args.ipa)
