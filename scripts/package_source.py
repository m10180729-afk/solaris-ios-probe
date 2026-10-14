"""Package the known source paths at ZIP root, without credentials or generated files."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT.parent / "Solaris-1.0-source.zip"
SKIP = {".git", "__pycache__", "build", "dist", "bin", "obj", "node_modules", "Vendor", ".gradle"}
TOP = {".github", "ios", "receiver", "scripts", "tests", "docs", "windows-native", "android",
       "shared", "backend", "supabase", "package.json", "package-lock.json", "README.md", ".gitignore", "UPLOAD_GIT_BASH.sh"}

with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if relative.parts[0] not in TOP or not path.is_file() or path.is_symlink() or SKIP.intersection(relative.parts):
            continue
        if '.temp' in relative.parts or any(part.endswith((".xcodeproj", ".xcworkspace")) for part in relative.parts):
            continue
        if path.suffix in {".pyc", ".ipa", ".p12", ".mobileprovision", ".apk", ".aab", ".jks", ".keystore"} or path.name == "local.properties" or path.name.startswith(".env"):
            continue
        archive.write(path, relative)
with zipfile.ZipFile(OUTPUT) as archive:
    assert archive.testzip() is None
    for name in (".github/workflows/build-ios-probe.yml", "shared/index.html", "backend/001_solaris.sql", "docs/SOLARIS_SPEC_KO.md", "docs/BUILD61_STATUS_KO.md",
                 "docs/BUILD62_STATUS_KO.md", "docs/START_BUILD62_KO.md", "docs/ANDROID_BUILD62_DEVICE_CHECK_KO.md", "docs/BUILD63_AUTH_KO.md", "docs/BUILD64_UI_KO.md",
                 "android/app/src/main/java/org/solaris/receiver/ReceiveOnlyMedia.java", "android/app/src/test/java/org/solaris/receiver/ReceiveOnlyMediaTest.java", "backend/005_build65_accounts_presence_invites.sql",
                 "docs/BUILD65_KO.md", "docs/BUILD66_KO.md", "backend/006_build66_google_only.sql", "supabase/migrations/20261014082301_google_only_auth_build66.sql", "scripts/check_android_pages.py", "tests/test_android_pages.py",
                 "docs/BUILD67_KO.md", "docs/SOLARIS_1_0_KO.md", "backend/007_build67_sharing_resilience.sql", "supabase/migrations/20261014132549_sharing_resilience_build67.sql",
                 "shared/signal-queue.mjs", "tests/database_build67_sharing_leases.test.mjs", "windows-native/SolarisNativeHost/OriginalRtpEngine.cs",
                 "tests/unified_sharing_build67.test.mjs", "tests/unified_auth_refresh_build67.test.mjs",
                 "windows-native/Solaris.Adapter.Tests/Solaris.Adapter.Tests.csproj", "windows-native/Solaris.Adapter.Tests/Program.cs", "windows-native/Solaris.Adapter.Tests/RtpAdapterTests.cs"):
        assert name in archive.namelist(), name
    print(f"Packaged {len(archive.namelist())} files: {OUTPUT}")
