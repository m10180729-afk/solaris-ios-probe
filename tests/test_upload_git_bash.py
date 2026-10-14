"""Exercise the uploader against real local Git remotes, without GitHub access."""
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
UPLOADER = ROOT / "UPLOAD_GIT_BASH.sh"
BASE_BRANCH = "codex/solaris-build58-20261011-210109-1852"
SOURCE_DIRS = (".github", "ios", "receiver", "scripts", "tests", "docs",
               "windows-native", "android", "shared", "backend")


def bash_available():
    """Finding bash.exe is insufficient when its MSYS runtime cannot start."""
    if not all(shutil.which(tool) for tool in ("git", "bash", "tar")):
        return False, "Git, Bash and tar are required"
    try:
        result = subprocess.run(["bash", "-c", "exit 0"], text=True, encoding="utf-8",
                                capture_output=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, f"Bash runtime is unavailable: {error}"
    if result.returncode:
        status = f"0x{result.returncode & 0xffffffff:08X}" if os.name == "nt" else str(result.returncode)
        return False, f"Bash runtime cannot initialize ({status}); local Git upload integration requires a working Bash"
    return True, ""


BASH_AVAILABLE, BASH_SKIP_REASON = bash_available()


@unittest.skipUnless(BASH_AVAILABLE, BASH_SKIP_REASON)
class UploadIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="solaris-uploader-test-")
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
                        GIT_TERMINAL_PROMPT="0", TMPDIR=self.folder.as_posix())
        for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
            self.env.pop(name, None)
        self.remote = self.folder / "remote.git"
        self.seed = self.folder / "seed"
        self.git("init", "--bare", str(self.remote))
        self.git("init", "--initial-branch=main", str(self.seed))
        self.git("config", "user.name", "Uploader test", cwd=self.seed)
        self.git("config", "user.email", "uploader-test@localhost", cwd=self.seed)
        (self.seed / "README.md").write_text("build54\n", encoding="utf-8")
        self.commit_seed("main fixture")
        self.main_sha = self.git("rev-parse", "HEAD", cwd=self.seed).strip()
        self.git("remote", "add", "origin", self.remote.as_posix(), cwd=self.seed)
        self.git("push", "origin", "main", cwd=self.seed)
        self.git("checkout", "-b", BASE_BRANCH, cwd=self.seed)
        (self.seed / "shared").mkdir()
        (self.seed / "shared" / "obsolete.mjs").write_text("build58 obsolete\n")
        self.commit_seed("build58 fixture")
        self.base_sha = self.git("rev-parse", "HEAD", cwd=self.seed).strip()
        self.git("push", "origin", BASE_BRANCH, cwd=self.seed)

        # The production script is unchanged except for these four fixture
        # constants: the local remote, its real main/base SHAs, and branch name.
        script = UPLOADER.read_text(encoding="utf-8")
        replacements = {"SOLARIS_REMOTE": self.remote.as_posix(), "SOLARIS_BASE_BRANCH": BASE_BRANCH,
                        "SOLARIS_BASE_COMMIT": self.base_sha, "SOLARIS_MAIN_COMMIT": self.main_sha}
        for name, value in replacements.items():
            # A function keeps Windows backslashes out of re.sub replacement
            # escape processing; shell quoting also preserves literal paths.
            script, count = re.subn(rf'^{name}="[^"\n]+"$', lambda _match: f'{name}={shlex.quote(value)}', script,
                                    count=1, flags=re.MULTILINE)
            self.assertEqual(count, 1, f"missing uploader fixture constant {name}")
        self.downloads = self.folder / "download 폴더"
        self.downloads.mkdir()
        self.script = self.downloads / "UPLOAD_GIT_BASH.sh"
        self.script.write_text(script, encoding="utf-8")
        self.source = self.folder / "source 한글 폴더"
        self.source.mkdir()
        for name in SOURCE_DIRS:
            directory = self.source / name
            directory.mkdir()
            (directory / ".keep").write_text("source fixture\n")
        (self.source / "README.md").write_text("build66\n")
        (self.source / ".gitignore").write_bytes((ROOT / ".gitignore").read_bytes())
        (self.source / "UPLOAD_GIT_BASH.sh").write_text(script, encoding="utf-8")
        (self.source / "package.json").write_text('{}\n')
        (self.source / "package-lock.json").write_text('{}\n')
        (self.source / "shared" / "index.html").write_text("build66 media\n")
        (self.source / "ios" / "project.yml").write_text("CURRENT_PROJECT_VERSION: '66'\n")
        (self.source / "android" / "app").mkdir()
        (self.source / "android" / "app" / "build.gradle").write_text("versionCode 66\n")

    def git(self, *args, cwd=None):
        result = subprocess.run(["git", *args], cwd=cwd or self.folder, env=self.env,
                                text=True, encoding="utf-8", capture_output=True, timeout=20)
        if result.returncode:
            self.fail(f"Fixture Git failed: {result.stderr}")
        return result.stdout

    def commit_seed(self, message):
        self.git("add", "-A", cwd=self.seed)
        self.git("commit", "-m", message, cwd=self.seed)

    def heads(self):
        return dict(line.split(" ", 1) for line in self.git(
            "--git-dir", str(self.remote), "for-each-ref", "--format=%(refname:short) %(objectname)",
            "refs/heads/").splitlines())

    def run_upload(self, *args, default_source=False):
        script = self.source / "UPLOAD_GIT_BASH.sh" if default_source else self.script
        command = ["bash", script.as_posix(), *args]
        if not default_source:
            command.append(self.source.as_posix())
        return subprocess.run(command, cwd=self.downloads, env=self.env, text=True, encoding="utf-8",
                              capture_output=True, timeout=30)

    def test_upload_preserves_history_and_excludes_local_files(self):
        local_files = ("android/upload.jks", "ios/signing.p12", "android/local.properties",
                       "shared/.env", "android/app/build/large.apk", "shared/node_modules/private.js")
        for name in local_files:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("local-only fixture\n")
        result = self.run_upload()
        self.assertEqual(result.returncode, 0, result.stderr)
        heads = self.heads()
        self.assertEqual(heads["main"], self.main_sha)
        self.assertEqual(heads[BASE_BRANCH], self.base_sha)
        branches = [name for name in heads if name.startswith("codex/solaris-build66-")]
        self.assertEqual(len(branches), 1)
        branch = branches[0]
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse", f"{branch}^").strip(),
                         self.base_sha)
        tree = set(self.git("--git-dir", str(self.remote), "ls-tree", "-r", "--name-only", branch).splitlines())
        self.assertIn("shared/index.html", tree)
        self.assertNotIn("shared/obsolete.mjs", tree)
        for name in local_files:
            self.assertNotIn(name, tree)
            self.assertTrue((self.source / name).exists(), "original source must remain intact")
        self.assertIn("업로드 완료", result.stdout)

    def test_default_source_is_the_script_folder(self):
        result = self.run_upload(default_source=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.heads()), 3)

    def test_changed_main_stops_before_upload(self):
        self.git("checkout", "main", cwd=self.seed)
        (self.seed / "new-work.txt").write_text("new owner work\n")
        self.commit_seed("later main")
        self.git("push", "origin", "main", cwd=self.seed)
        before = self.heads()
        result = self.run_upload()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("main에 새 작업", result.stderr)
        self.assertEqual(self.heads(), before)

    def test_changed_build58_stops_before_upload(self):
        (self.seed / "new-work.txt").write_text("new owner work\n")
        self.commit_seed("later build58")
        self.git("push", "origin", BASE_BRANCH, cwd=self.seed)
        before = self.heads()
        result = self.run_upload()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("build58 기준 브랜치가 변경", result.stderr)
        self.assertEqual(self.heads(), before)

    def test_missing_source_explains_which_folder_to_select(self):
        shutil.rmtree(self.source / "shared")
        before = self.heads()
        result = self.run_upload()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("소스가 빠져 있습니다: shared", result.stderr)
        self.assertEqual(self.heads(), before)
        self.assertEqual(list(self.folder.glob("solaris-upload-*")), [])

    def test_wrong_ios_build_is_rejected(self):
        (self.source / "ios" / "project.yml").write_text("CURRENT_PROJECT_VERSION: '56'\n")
        result = self.run_upload()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("build66 소스용", result.stderr)
        self.assertEqual(len(self.heads()), 2)

    def test_wrong_android_build_is_rejected(self):
        (self.source / "android" / "app" / "build.gradle").write_text("versionCode 660\n")
        result = self.run_upload()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Android 소스 버전", result.stderr)
        self.assertEqual(len(self.heads()), 2)

    def test_dry_run_does_not_push(self):
        before = self.heads()
        result = self.run_upload("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("검증 완료", result.stdout)
        self.assertEqual(self.heads(), before)
        self.assertEqual(list(self.folder.glob("solaris-upload-*")), [])

    def test_rejected_push_is_reported_as_failure(self):
        hook = self.remote / "hooks" / "pre-receive"
        hook.write_text("#!/bin/sh\nexit 1\n")
        hook.chmod(0o755)
        before = self.heads()
        result = self.run_upload()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("업로드 완료", result.stdout)
        self.assertIn("업로드가 중단", result.stderr)
        self.assertEqual(self.heads(), before)
        self.assertTrue((self.source / "shared" / "index.html").exists())


if __name__ == "__main__":
    unittest.main()
