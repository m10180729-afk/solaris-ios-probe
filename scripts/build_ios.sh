#!/usr/bin/env bash
# Run on macOS with Xcode and XcodeGen. No Apple credentials required at build time.
# Output is ad-hoc signed without App Group entitlements, NOT device-installable.
set -euo pipefail
SOLARIS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SOLARIS_ROOT"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Requires macOS/Xcode. Windows is for installation and the receiver, not this build."
  exit 1
fi
for executable in xcodegen xcodebuild codesign ditto python3 curl xcrun plutil; do
  command -v "$executable" >/dev/null || { echo "Missing: $executable"; exit 1; }
done
SOLARIS_OUTPUT="$SOLARIS_ROOT/dist/Solaris-0.3.2-build30-resign.ipa"
if [[ -e "$SOLARIS_OUTPUT" ]]; then
  echo "Output already exists. Move/rename it before rebuilding: $SOLARIS_OUTPUT"
  exit 1
fi
python3 scripts/check_project.py
mkdir -p build/diagnostics dist
SOLARIS_STAGE="$(mktemp -d "$SOLARIS_ROOT/build/package.XXXXXX")"
trap 'echo "iOS BUILD FAILED: see build/diagnostics (not a successful IPA build)." >&2' ERR
python3 scripts/prepare_webrtc.py 2>&1 | tee build/diagnostics/dependency.log
(
  cd ios
  xcodegen generate --spec project.yml
)
cp ios/SolarisProbe.xcodeproj/project.pbxproj build/diagnostics/project.pbxproj
python3 scripts/check_webrtc.py --project ios/SolarisProbe.xcodeproj/project.pbxproj \
  2>&1 | tee build/diagnostics/generated-project.log
xcodebuild \
  -project ios/SolarisProbe.xcodeproj \
  -scheme SolarisProbe \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$SOLARIS_STAGE/DerivedData" \
  -resultBundlePath "$SOLARIS_STAGE/Build.xcresult" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  build 2>&1 | tee build/diagnostics/xcodebuild.log
mkdir -p "$SOLARIS_STAGE/Payload"
ditto "$SOLARIS_STAGE/DerivedData/Build/Products/Release-iphoneos/SolarisProbe.app" \
  "$SOLARIS_STAGE/Payload/SolarisProbe.app"
SOLARIS_APP="$SOLARIS_STAGE/Payload/SolarisProbe.app"
SOLARIS_EXTENSION="$SOLARIS_APP/PlugIns/SolarisBroadcast.appex"
python3 scripts/check_webrtc.py --app "$SOLARIS_APP" \
  2>&1 | tee build/diagnostics/built-app.log
# This layout is intentional: extension-local @rpath, no host-app duplicate.
# Missing diagnostics alone is NOT proof that a framework or App Group failed.
SOLARIS_WEBRTC="$SOLARIS_EXTENSION/Frameworks/WebRTC.framework"
test -d "$SOLARIS_WEBRTC" || {
  echo "WebRTC.framework is missing from the broadcast extension. Refusing to package an IPA that can crash before ReplayKit starts." >&2
  exit 1
}
codesign --force --sign - --timestamp=none "$SOLARIS_WEBRTC"
codesign --force --sign - --timestamp=none "$SOLARIS_EXTENSION"
codesign --force --sign - --timestamp=none "$SOLARIS_APP"
codesign --verify --deep --strict "$SOLARIS_APP"
ditto -c -k --keepParent "$SOLARIS_STAGE/Payload" "$SOLARIS_OUTPUT"
python3 scripts/check_project.py --ipa "$SOLARIS_OUTPUT" \
  2>&1 | tee build/diagnostics/ipa.log
cp ios/App/Resources/solaris-p2p.html dist/Solaris-Windows-0.3.2-build30.html
cp docs/STEP3_WEBRTC_SCREEN_KO.md dist/START_HERE_KO.md
echo "Packaged: $SOLARIS_OUTPUT"
echo "RE-SIGNING AND PHYSICAL-DEVICE TEST REQUIRED. No install/capture success is claimed."
