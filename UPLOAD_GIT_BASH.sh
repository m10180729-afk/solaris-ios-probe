#!/usr/bin/env bash
# Upload the build66 source as a review branch, preserving the build58 history.
set -euo pipefail

SOLARIS_REMOTE="https://github.com/m10180729-afk/solaris-ios-probe.git"
SOLARIS_BASE_BRANCH="codex/solaris-build58-20261011-210109-1852"
SOLARIS_BASE_COMMIT="a0054ba78a922cd750b14ce70ea6b9b78dd57670"
SOLARIS_MAIN_COMMIT="4c50dbe33721b5d10db714bd79da74267a8863b4"
SOLARIS_SCRIPT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"
SOLARIS_SOURCE="$(dirname -- "$SOLARIS_SCRIPT")"
SOLARIS_CHECKOUT=""
SOLARIS_DRY_RUN=0
SOLARIS_PATHS=(.github ios receiver scripts tests docs windows-native android shared backend README.md .gitignore UPLOAD_GIT_BASH.sh package.json package-lock.json)

solaris_help() {
  cat <<'USAGE'
Solaris build66 Git Bash 업로드

  bash UPLOAD_GIT_BASH.sh
  bash UPLOAD_GIT_BASH.sh "/c/Users/내이름/Downloads/Solaris-source"
  bash UPLOAD_GIT_BASH.sh --dry-run "/c/Users/내이름/Downloads/Solaris-source"

소스 ZIP을 전부 압축 해제한 폴더에서 실행하거나 그 폴더를 인자로 지정하세요.
--dry-run은 소스와 Git 기록을 확인하고 로컬 커밋까지만 생성합니다.
업로드하면 별도 codex/solaris-build66 브랜치의 GitHub Actions가 실행됩니다.
USAGE
}

solaris_fail() {
  printf '\n%s\n' "$1" >&2
  exit 1
}

solaris_exit() {
  local SOLARIS_STATUS=$?
  if [[ -n "$SOLARIS_CHECKOUT" ]]; then
    if [[ "$SOLARIS_STATUS" -eq 0 ]]; then
      rm -rf -- "$SOLARIS_CHECKOUT"
    else
      printf '\n확인용 임시 복사본: %s\n' "$SOLARIS_CHECKOUT" >&2
    fi
  fi
}
trap solaris_exit EXIT
trap 'printf "\n업로드가 중단됐습니다. 위의 Git 오류를 확인한 뒤 다시 실행하세요.\n" >&2' ERR

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  solaris_help
  exit 0
fi
if [[ "${1:-}" == "--dry-run" ]]; then
  SOLARIS_DRY_RUN=1
  shift
fi
[[ "$#" -le 1 ]] || solaris_fail "사용법: bash UPLOAD_GIT_BASH.sh [--dry-run] [소스 폴더]"
if [[ "$#" -eq 1 ]]; then
  SOLARIS_SOURCE="$1"
fi
[[ -d "$SOLARIS_SOURCE" ]] || solaris_fail "소스 폴더를 찾을 수 없습니다: $SOLARIS_SOURCE"
SOLARIS_SOURCE="$(cd -- "$SOLARIS_SOURCE" && pwd)"

for SOLARIS_TOOL in git tar mktemp; do
  command -v "$SOLARIS_TOOL" >/dev/null || solaris_fail "Git Bash에 $SOLARIS_TOOL 명령이 없습니다. Git for Windows 설치를 확인하세요."
done
for SOLARIS_PATH in "${SOLARIS_PATHS[@]}"; do
  [[ -e "$SOLARIS_SOURCE/$SOLARIS_PATH" ]] || solaris_fail "소스가 빠져 있습니다: $SOLARIS_PATH. build66 소스 ZIP을 전부 압축 해제하고 shared, ios, android 폴더가 있는 위치를 지정하세요."
done
grep -Fq "CURRENT_PROJECT_VERSION: '66'" "$SOLARIS_SOURCE/ios/project.yml" || solaris_fail "이 업로더는 build66 소스용입니다. 최신 build66 소스 ZIP을 압축 해제하세요."
grep -Eq 'versionCode[[:space:]]+66([[:space:]]|$)' "$SOLARIS_SOURCE/android/app/build.gradle" || solaris_fail "Android 소스 버전이 build66과 다릅니다. 최신 소스 ZIP을 새 폴더에 압축 해제하세요."

printf '소스 폴더: %s\n' "$SOLARIS_SOURCE"
SOLARIS_CHECKOUT="$(mktemp -d "${TMPDIR:-/tmp}/solaris-upload-XXXXXX")"
git clone --branch "$SOLARIS_BASE_BRANCH" --single-branch "$SOLARIS_REMOTE" "$SOLARIS_CHECKOUT/repo"
cd -- "$SOLARIS_CHECKOUT/repo"
[[ "$(git rev-parse HEAD)" == "$SOLARIS_BASE_COMMIT" ]] || solaris_fail "build58 기준 브랜치가 변경됐습니다. 최신 GitHub 작업과 이 소스를 먼저 통합해야 합니다."
git fetch origin refs/heads/main:refs/remotes/origin/main
[[ "$(git rev-parse refs/remotes/origin/main)" == "$SOLARIS_MAIN_COMMIT" ]] || solaris_fail "main에 새 작업이 있습니다. 최신 GitHub 작업과 이 소스를 먼저 통합해야 합니다."
git merge-base --is-ancestor refs/remotes/origin/main HEAD || solaris_fail "build58과 main의 기록이 일치하지 않습니다. 저장소 상태를 확인하세요."
SOLARIS_BRANCH="codex/solaris-build66-$(date +%Y%m%d-%H%M%S)-$$"
git checkout -b "$SOLARIS_BRANCH"

# An isolated empty Git index honors the source's ignores. No Git metadata or
# generated APK/build folders, local config or signing keys are copied in.
git init --quiet "$SOLARIS_CHECKOUT/source-index"
git -C "$SOLARIS_CHECKOUT/source-index" --work-tree="$SOLARIS_SOURCE" add -- "${SOLARIS_PATHS[@]}"
SOLARIS_TREE="$(git -C "$SOLARIS_CHECKOUT/source-index" write-tree)"
# Remove only known source paths in this disposable checkout so removed files
# do not survive from build58. The user's extracted source folder is untouched.
rm -rf -- "${SOLARIS_PATHS[@]}"
git -C "$SOLARIS_CHECKOUT/source-index" archive --format=tar "$SOLARIS_TREE" | tar -xf -
cp -- "$SOLARIS_SCRIPT" UPLOAD_GIT_BASH.sh
git add -A -- "${SOLARIS_PATHS[@]}"
if git diff --cached --quiet; then
  printf '기준 브랜치와 소스가 같습니다. 업로드할 변경이 없습니다.\n'
  exit 0
fi
git config user.name >/dev/null || git config user.name "Solaris local build"
git config user.email >/dev/null || git config user.email "solaris-build@localhost"
git commit -m "Refine existing desktop and mobile UI from official Discord references (build66)"
if [[ "$SOLARIS_DRY_RUN" -eq 1 ]]; then
  printf '\n검증 완료. --dry-run으로 실행했으므로 GitHub 업로드는 생략했습니다.\n'
  exit 0
fi
git push -u origin "$SOLARIS_BRANCH"
printf '\n업로드 완료: %s\n' "$SOLARIS_BRANCH"
printf 'Windows / Android / iOS 빌드 결과: https://github.com/m10180729-afk/solaris-ios-probe/actions\n'
printf '공식 버전 승인과 main 병합은 프로젝트 소유자가 결정합니다.\n'
