#!/usr/bin/env bash
# Creates a review branch; never rewrites main or publishes an official release.
set -euo pipefail
SOLARIS_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOLARIS_REMOTE="https://github.com/m10180729-afk/solaris-ios-probe.git"
SOLARIS_BASE="4c50dbe33721b5d10db714bd79da74267a8863b4"
trap 'echo "Upload stopped. Read the Git error above; no force push was used." >&2' ERR
command -v git >/dev/null
test -f "$SOLARIS_SOURCE/shared/index.html"
if ! grep -Fq "CURRENT_PROJECT_VERSION: '56'" "$SOLARIS_SOURCE/ios/project.yml"; then
  echo "Extract the build56 source ZIP before running this uploader." >&2
  exit 1
fi
SOLARIS_CHECKOUT="$(mktemp -d "${TMPDIR:-/tmp}/solaris-upload-XXXXXX")"
git clone --branch main --single-branch "$SOLARIS_REMOTE" "$SOLARIS_CHECKOUT/repo"
cd "$SOLARIS_CHECKOUT/repo"
if [[ "$(git rev-parse HEAD)" != "$SOLARIS_BASE" ]]; then
  echo "main has changed since build54. Merge this source on a review branch; do not overwrite newer work." >&2
  exit 1
fi
SOLARIS_BRANCH="codex/solaris-build56-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$SOLARIS_BRANCH"
for SOLARIS_PATH in .github ios receiver scripts tests docs windows-native android shared backend README.md .gitignore UPLOAD_GIT_BASH.sh package.json package-lock.json; do
  cp -R "$SOLARIS_SOURCE/$SOLARIS_PATH" .
done
git add -- .github ios receiver scripts tests docs windows-native android shared backend README.md .gitignore UPLOAD_GIT_BASH.sh package.json package-lock.json
git config user.name >/dev/null || git config user.name "Solaris local build"
git config user.email >/dev/null || git config user.email "solaris-build@localhost"
git commit -m "Integrate authenticated Solaris app, friends, servers and streamed files (build56)"
git push -u origin "$SOLARIS_BRANCH"
echo "Pushed review branch: $SOLARIS_BRANCH"
echo "https://github.com/m10180729-afk/solaris-ios-probe/actions"
echo "Actions builds test installers. The project owner approves merging and official releases."
