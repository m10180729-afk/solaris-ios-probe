"""Reject the old product-name copy bug; inspect generated project and built binaries."""
import argparse
import json
from pathlib import Path
import plistlib
import subprocess


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_project_graph(project, source_root):
    objects = project["objects"]
    parents = {}
    for identifier, item in objects.items():
        for child in item.get("children", []):
            parents[child] = identifier

    def resolve(identifier, seen=None):
        seen = set() if seen is None else seen
        require(identifier not in seen, "Cycle in Xcode file groups")
        seen.add(identifier)
        item = objects[identifier]
        tree = item.get("sourceTree", "<group>")
        path = Path(item.get("path", ""))
        if tree == "<absolute>":
            return path
        if tree == "SOURCE_ROOT":
            return source_root / path
        require(tree == "<group>", f"WebRTC source must exist before build, not {tree}/{path}")
        base = resolve(parents[identifier], seen) if identifier in parents else source_root
        return base / path

    counts = {}
    sources = set()
    for target in objects.values():
        if target.get("isa") != "PBXNativeTarget":
            continue
        name = target["name"]
        linked, embedded = [], []
        for phase_id in target.get("buildPhases", []):
            phase = objects[phase_id]
            for file_id in phase.get("files", []):
                file = objects[file_id]
                ref_id = file.get("fileRef") or file.get("productRef")
                if ref_id is None:
                    continue
                ref = objects[ref_id]
                ref_name = ref.get("path", ref.get("productName", ref.get("name", "")))
                # Source files such as BroadcastWebRTCSender.swift contain
                # "WebRTC" in their names but are not framework references.
                if not ((ref_name.endswith("WebRTC.xcframework") or ref_name.endswith("WebRTC.framework"))
                        or ("WebRTC" in ref_name and "productRef" in file)):
                    continue
                require("productRef" not in file,
                        f"{name}: invalid WebRTC package product reference; reproduces Release-iphoneos/WebRTC copy failure")
                require(ref_name.endswith("WebRTC.xcframework"), f"Unexpected WebRTC file reference: {ref_name}")
                source = resolve(ref_id).resolve()
                require((source / "Info.plist").is_file(), f"WebRTC copy source does not exist: {source}")
                sources.add(str(source))
                if phase["isa"] == "PBXFrameworksBuildPhase":
                    linked.append(ref_id)
                elif phase["isa"] == "PBXCopyFilesBuildPhase":
                    require(str(phase["dstSubfolderSpec"]) == "10", "WebRTC must embed in Frameworks")
                    require(not phase.get("dstPath"), "WebRTC embed destination must be the extension Frameworks directory")
                    embedded.append(ref_id)
                else:
                    raise ValueError(f"WebRTC in unexpected phase {phase['isa']}")
        counts[name] = (len(linked), len(embedded))
        if name == "SolarisBroadcast":
            require(len(linked) == 1 and linked == embedded,
                    f"Extension must link and embed the same real XCFramework once: {counts[name]}")
        elif name == "SolarisProbe":
            require(len(linked) == 1 and linked == embedded,
                    f"Host receiver must link and embed the same real XCFramework once: {counts[name]}")
    require(counts.get("SolarisBroadcast") == (1, 1), "Broadcast target missing")
    require(counts.get("SolarisProbe") == (1, 1), "Host receiver target missing WebRTC")
    for source in sorted(sources):
        print(f"VERIFIED existing WebRTC copy/link source: {source}")
    print("PASS generated project: real fileRef, host receiver and extension each link/embed once")


def command(*args):
    return subprocess.check_output(args, text=True)


def check_built_app(app):
    extension = app / "PlugIns/SolarisBroadcast.appex"
    host_framework = app / "Frameworks/WebRTC.framework"
    extension_framework = extension / "Frameworks/WebRTC.framework"
    frameworks = [host_framework, extension_framework]
    for framework in frameworks:
        require((framework / "WebRTC").is_file(), f"Missing required embedded binary: {framework / 'WebRTC'}")
    copies = list(app.rglob("WebRTC.framework"))
    require(sorted(copies) == sorted(frameworks),
            f"Expected one host and one extension WebRTC.framework, got: {copies}")
    for framework in frameworks:
        info = plistlib.loads((framework / "Info.plist").read_bytes())
        require(info.get("CFBundleExecutable") == "WebRTC", "Invalid WebRTC executable metadata")
        require("iPhoneOS" in info.get("CFBundleSupportedPlatforms", []), "Wrong WebRTC platform slice")
    for bundle in (app, extension):
        metadata = plistlib.loads((bundle / "Info.plist").read_bytes())
        executable = bundle / metadata["CFBundleExecutable"]
        libraries = command("xcrun", "otool", "-L", str(executable))
        print(libraries)
        require("@rpath/WebRTC.framework/WebRTC" in libraries,
                f"{bundle.name} does not dynamically link WebRTC")
        loads = command("xcrun", "otool", "-l", str(executable))
        require("path @executable_path/Frameworks (offset" in loads,
                f"Missing {bundle.name} local Frameworks LC_RPATH")
    for framework in frameworks:
        binary = framework / "WebRTC"
        architectures = command("xcrun", "lipo", "-archs", str(binary)).split()
        require(architectures == ["arm64"], f"Wrong device framework architectures: {architectures}")
        require("@rpath/WebRTC.framework/WebRTC" in command("xcrun", "otool", "-D", str(binary)),
                "WebRTC install name does not match loader path")
    print("PASS built app: host receiver and broadcast extension have arm64 WebRTC loader paths")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path)
    parser.add_argument("--app", type=Path)
    args = parser.parse_args()
    if args.project:
        data = command("plutil", "-convert", "json", "-o", "-", str(args.project))
        check_project_graph(json.loads(data), args.project.resolve().parent.parent)
    if args.app:
        check_built_app(args.app)
    require(args.project or args.app, "Pass --project or --app")


if __name__ == "__main__":
    main()
