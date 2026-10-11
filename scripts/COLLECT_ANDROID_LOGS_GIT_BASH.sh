#!/usr/bin/env bash
# Collect Solaris diagnostics on the owner's computer after reproducing a crash.
set -euo pipefail
command -v adb >/dev/null || { printf '%s\n' 'Android SDK Platform-Tools의 adb가 필요합니다.' >&2; exit 1; }
SOLARIS_OUT="${1:-Solaris-Android-build58-diagnostics}"
mkdir -p -- "$SOLARIS_OUT"
adb get-state >/dev/null
adb shell dumpsys package org.solaris.receiver > "$SOLARIS_OUT/package.txt"
adb shell getprop ro.build.version.release > "$SOLARIS_OUT/android-version.txt"
adb shell getprop ro.product.model > "$SOLARIS_OUT/device-model.txt"
adb logcat -b crash -d -v threadtime | awk '/org\.solaris\.receiver|Solaris|ScreenEngine|PeerConnection|libjingle|libwebrtc|MediaCodec|Fatal signal|Abort message|backtrace|AndroidRuntime/' > "$SOLARIS_OUT/crash.txt"
adb shell run-as org.solaris.receiver cat files/screen-errors.json > "$SOLARIS_OUT/screen-errors.json" 2> "$SOLARIS_OUT/collection-status.txt" || true
printf '진단 파일: %s\n' "$SOLARIS_OUT"
