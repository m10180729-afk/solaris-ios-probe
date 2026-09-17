"""Package source and instructions only; no credentials, generated builds or caches."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT.parent / "Solaris-iOS-Probe-0.1.0.zip"
SKIP = {".git", "__pycache__", "build", "dist", "node_modules"}

if OUTPUT.exists():
    raise SystemExit(f"Already exists; move the old archive before packaging: {OUTPUT}")
with zipfile.ZipFile(OUTPUT, "x", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if not path.is_file() or path.is_symlink() or SKIP.intersection(relative.parts):
            continue
        if any(part.endswith((".xcodeproj", ".xcworkspace")) for part in relative.parts):
            continue
        if path.suffix in {".pyc", ".ipa", ".p12", ".mobileprovision"} or path.name.startswith(".env"):
            continue
        archive.write(path, Path("Solaris-iOS-Probe") / relative)
with zipfile.ZipFile(OUTPUT) as archive:
    assert archive.testzip() is None
    print(f"Packaged {len(archive.namelist())} files: {OUTPUT}")
print(f"Size: {OUTPUT.stat().st_size} bytes")
