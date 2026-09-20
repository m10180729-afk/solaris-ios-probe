#!/usr/bin/env bash
# Run explicitly in Git Bash. Copies only this package's source paths.
# Never modifies the existing Downloads checkout or rewrites remote history.
set -euo pipefail
SOLARIS_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOLARIS_REMOTE="https://github.com/m10180729-afk/solaris-ios-probe.git"
trap 'echo "Upload stopped. Read the Git error above; no force push was used." >&2' ERR
command -v git >/dev/null
test -f "$SOLARIS_SOURCE/.github/workflows/build-ios-probe.yml"
test -f "$SOLARIS_SOURCE/ios/project.yml"
echo "Uploading Solaris 0.3.2 build 32: Windows 1080p120 sender and iPad/Windows receiver"
SOLARIS_CHECKOUT="$(mktemp -d "${TMPDIR:-/tmp}/solaris-upload-XXXXXX")"
echo "Preparing a fresh checkout: $SOLARIS_CHECKOUT"
git clone --branch main --single-branch "$SOLARIS_REMOTE" "$SOLARIS_CHECKOUT/repo"
cd "$SOLARIS_CHECKOUT/repo"
for SOLARIS_PATH in .github ios receiver scripts tests docs README.md .gitignore UPLOAD_GIT_BASH.sh; do
  cp -R "$SOLARIS_SOURCE/$SOLARIS_PATH" .
done
git add -- .github ios receiver scripts tests docs README.md .gitignore UPLOAD_GIT_BASH.sh
if git diff --cached --quiet; then
  echo "Already uploaded. Check GitHub Actions; use Run workflow if no run exists."
else
  git config user.name >/dev/null || git config user.name "Solaris local build"
  git config user.email >/dev/null || git config user.email "solaris-build@localhost"
  git commit -m "Add Windows 1080p120 screen sharing to iPad and Windows (build32)"
  git push origin HEAD:main
  echo "Uploaded. GitHub Actions will run the checks and build automatically."
fi
echo "https://github.com/m10180729-afk/solaris-ios-probe/actions"
