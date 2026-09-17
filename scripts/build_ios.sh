#!/usr/bin/env bash
# Run on macOS with Xcode and XcodeGen. No Apple credentials required at build time.
# Output is ad-hoc signed to retain requested entitlements, NOT device-installable.
set -euo pipefail
SOLARIS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SOLARIS_ROOT"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Requires macOS/Xcode. Windows is for installation and the receiver, not this build."
  exit 1
fi
for executable in xcodegen xcodebuild codesign ditto python3; do
  command -v "$executable" >/dev/null || { echo "Missing: $executable"; exit 1; }
done
SOLARIS_OUTPUT="$SOLARIS_ROOT/dist/SolarisProbe-resign.ipa"
if [[ -e "$SOLARIS_OUTPUT" ]]; then
  echo "Output already exists. Move/rename it before rebuilding: $SOLARIS_OUTPUT"
  exit 1
fi
python3 scripts/check_project.py
mkdir -p build dist
SOLARIS_STAGE="$(mktemp -d "$SOLARIS_ROOT/build/package.XXXXXX")"
(
  cd ios
  xcodegen generate --spec project.yml
)
xcodebuild \
  -project ios/SolarisProbe.xcodeproj \
  -scheme SolarisProbe \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$SOLARIS_STAGE/DerivedData" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  build
mkdir -p "$SOLARIS_STAGE/Payload"
ditto "$SOLARIS_STAGE/DerivedData/Build/Products/Release-iphoneos/SolarisProbe.app" \
  "$SOLARIS_STAGE/Payload/SolarisProbe.app"
SOLARIS_APP="$SOLARIS_STAGE/Payload/SolarisProbe.app"
SOLARIS_EXTENSION="$SOLARIS_APP/PlugIns/SolarisBroadcast.appex"
test -d "$SOLARIS_EXTENSION"
# The WebRTC binary framework is embedded inside the broadcast extension.
SOLARIS_WEBRTC="$SOLARIS_EXTENSION/Frameworks/WebRTC.framework"
if [[ -d "$SOLARIS_WEBRTC" ]]; then
  codesign --force --sign - --timestamp=none "$SOLARIS_WEBRTC"
fi
# AltStore can inspect these requested App Group entitlements before local re-signing.
# An ad-hoc signature does NOT grant them on an iPhone/iPad.
codesign --force --sign - --timestamp=none --entitlements ios/Config/Probe.entitlements "$SOLARIS_EXTENSION"
codesign --force --sign - --timestamp=none --entitlements ios/Config/Probe.entitlements "$SOLARIS_APP"
codesign --verify --deep --strict "$SOLARIS_APP"
ditto -c -k --keepParent "$SOLARIS_STAGE/Payload" "$SOLARIS_OUTPUT"
python3 scripts/check_project.py --ipa "$SOLARIS_OUTPUT"
echo "Packaged: $SOLARIS_OUTPUT"
echo "RE-SIGNING AND PHYSICAL-DEVICE TEST REQUIRED. No install/capture success is claimed."
