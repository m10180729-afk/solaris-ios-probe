"""Package the known source paths at ZIP root, without credentials or generated files."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT.parent / "Solaris-0.3.2-build7-xcframework-fix.zip"
SKIP = {".git", "__pycache__", "build", "dist", "node_modules", "Vendor"}
TOP = {".github", "ios", "receiver", "scripts", "tests", "docs",
       "README.md", ".gitignore", "UPLOAD_GIT_BASH.sh"}

with zipfile.ZipFile(OUTPUT, "x", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if relative.parts[0] not in TOP or not path.is_file() or path.is_symlink() or SKIP.intersection(relative.parts):
            continue
        if any(part.endswith((".xcodeproj", ".xcworkspace")) for part in relative.parts):
            continue
        if path.suffix in {".pyc", ".ipa", ".p12", ".mobileprovision"} or path.name.startswith(".env"):
            continue
        archive.write(path, relative)
    archive.write(ROOT / "ios/App/Resources/solaris-p2p.html", "Solaris-Windows-0.3.2.html")
with zipfile.ZipFile(OUTPUT) as archive:
    assert archive.testzip() is None
    assert ".github/workflows/build-ios-probe.yml" in archive.namelist()
    print(f"Packaged {len(archive.namelist())} files: {OUTPUT}")
receiver = ROOT.parent / "Solaris-Windows-0.3.2.html"
receiver.write_bytes((ROOT / "ios/App/Resources/solaris-p2p.html").read_bytes())
print(f"Windows receiver: {receiver}")
