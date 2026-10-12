"""Package the known source paths at ZIP root, without credentials or generated files."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT.parent / "Solaris-0.4.0-build61-source.zip"
SKIP = {".git", "__pycache__", "build", "dist", "bin", "obj", "node_modules", "Vendor", ".gradle"}
TOP = {".github", "ios", "receiver", "scripts", "tests", "docs", "windows-native", "android",
       "shared", "backend", "package.json", "package-lock.json", "README.md", ".gitignore", "UPLOAD_GIT_BASH.sh"}

with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if relative.parts[0] not in TOP or not path.is_file() or path.is_symlink() or SKIP.intersection(relative.parts):
            continue
        if any(part.endswith((".xcodeproj", ".xcworkspace")) for part in relative.parts):
            continue
        if path.suffix in {".pyc", ".ipa", ".p12", ".mobileprovision", ".apk", ".aab", ".jks", ".keystore"} or path.name == "local.properties" or path.name.startswith(".env"):
            continue
        archive.write(path, relative)
with zipfile.ZipFile(OUTPUT) as archive:
    assert archive.testzip() is None
    for name in (".github/workflows/build-ios-probe.yml", "shared/index.html", "backend/001_solaris.sql", "docs/SOLARIS_SPEC_KO.md", "docs/BUILD61_STATUS_KO.md"):
        assert name in archive.namelist(), name
    print(f"Packaged {len(archive.namelist())} files: {OUTPUT}")
