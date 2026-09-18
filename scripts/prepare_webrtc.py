"""Materialize the pinned upstream binary as a file dependency before XcodeGen.

Same URL and SHA256 as stasel/WebRTC 153.0.0/Package.swift. This build targets
physical iOS devices only; simulator/macOS slices are deliberately not extracted.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import plistlib
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = "153.0.0"
URL = f"https://github.com/stasel/WebRTC/releases/download/{VERSION}/WebRTC-M153.xcframework.zip"
SHA256 = "3e3a8946f27510133e3feed04d05fa23505bbe366e977620503bfc7986c2b78f"


def device_library(info):
    libraries = [item for item in info["AvailableLibraries"]
                 if item.get("SupportedPlatform") == "ios"
                 and not item.get("SupportedPlatformVariant")
                 and "arm64" in item.get("SupportedArchitectures", [])]
    if len(libraries) != 1:
        raise ValueError("Expected exactly one arm64 iOS device slice in WebRTC.xcframework")
    library = libraries[0]
    if library["LibraryPath"] != "WebRTC.framework":
        raise ValueError("Expected LibraryPath WebRTC.framework, not a package product name")
    identifier = library["LibraryIdentifier"]
    if len(PurePosixPath(identifier).parts) != 1 or identifier in (".", "..", ""):
        raise ValueError("Invalid XCFramework LibraryIdentifier")
    return library


def validate_framework(xcframework):
    info = plistlib.loads((xcframework / "Info.plist").read_bytes())
    library = device_library(info)
    framework = xcframework / library["LibraryIdentifier"] / library["LibraryPath"]
    for relative in ("WebRTC", "Info.plist", "Modules/module.modulemap", "Headers/WebRTC.h"):
        if not (framework / relative).is_file():
            raise ValueError(f"WebRTC dependency incomplete: missing {framework / relative}")
    if (framework / "WebRTC").read_bytes()[:4] not in (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"):
        raise ValueError(f"Expected Mach-O binary: {framework / 'WebRTC'}")
    if "framework module WebRTC" not in (framework / "Modules/module.modulemap").read_text():
        raise ValueError("Missing WebRTC Swift/Clang import module declaration")
    return framework


def prepare(archive_path, destination):
    with archive_path.open("rb") as stream:
        checksum = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    if checksum.hexdigest() != SHA256:
        raise ValueError(f"WebRTC checksum mismatch: expected {SHA256}, got {checksum.hexdigest()}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="webrtc-", dir=destination.parent) as temporary:
        staged = Path(temporary) / "WebRTC.xcframework"
        staged.mkdir()
        with zipfile.ZipFile(archive_path) as archive:
            info = plistlib.loads(archive.read("WebRTC.xcframework/Info.plist"))
            library = device_library(info)
            prefix = f"WebRTC.xcframework/{library['LibraryIdentifier']}/"
            for entry in archive.infolist():
                if not entry.filename.startswith(prefix):
                    continue
                relative = PurePosixPath(entry.filename).relative_to("WebRTC.xcframework")
                if ".." in relative.parts or relative.is_absolute():
                    raise ValueError("Unsafe archive entry")
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("Unexpected symlink in iOS device slice")
                path = staged.joinpath(*relative.parts)
                if entry.is_dir():
                    path.mkdir(parents=True, exist_ok=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(entry) as source, path.open("wb") as target:
                        shutil.copyfileobj(source, target)
            info["AvailableLibraries"] = [library]
            (staged / "Info.plist").write_bytes(plistlib.dumps(info))
        framework = validate_framework(staged)
        (framework / "WebRTC").chmod(0o755)
        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(str(staged), destination)
    framework = validate_framework(destination)
    report = {"version": VERSION, "url": URL, "sha256": SHA256,
              "xcframework": str(destination.resolve()), "deviceFramework": str(framework.resolve())}
    print(json.dumps(report, indent=2), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    cache = ROOT / "build/dependencies"
    cache.mkdir(parents=True, exist_ok=True)
    archive = args.archive or cache / "WebRTC-M153.xcframework.zip"
    if not args.archive:
        subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--connect-timeout", "20",
                        "--max-time", "600", "--output", str(archive), URL], check=True)
    report = prepare(archive, ROOT / "ios/Vendor/WebRTC.xcframework")
    diagnostics = ROOT / "build/diagnostics"
    diagnostics.mkdir(parents=True, exist_ok=True)
    (diagnostics / "webrtc-source.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
