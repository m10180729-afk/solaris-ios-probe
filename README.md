# Solaris 0.4.0 build57

High quality screen sharing and original file transfer in one authenticated app for Windows, Android and iOS/iPadOS.

This checkpoint fixes the unified UI's forced resolution/FPS reduction and viewer-count downscaling. All broadcasts request high quality and 60fps, with source aspect ratio and device encoding limits respected. The build54 Windows hardware capture/RTP engine is reused; iOS reuses its constrained-baseline H264, native bitrate and frame/resolution policy. A receiver can change its own bitrate without reducing the shared source for everyone.

Android now uses compatible H264 baseline, actual portrait/landscape bounds, hardware size/rate capability checks, first-frame broadcast readiness, guarded projection-service startup and disposal, existing-display resize, and WebView renderer recovery. Diagnostics include bounded native errors and recent Android process-exit reasons. The precise reported physical crash has not been reproduced here; this is a tested source/build fix awaiting device verification.

The Discord-style layout separates server icons, channel navigation, live broadcasts, participants, profile/settings and connection controls. Online status is a small profile dot. Leave/delete actions are inside a separate server menu, colored red, and require confirmation. Broadcasting has no quality selector. Voice chat and microphone capture remain excluded.

## Start and continue

Read [build57 setup](docs/START_BUILD57_KO.md), [verification and limits](docs/BUILD57_STATUS_KO.md), [continuation memo](docs/CONTINUE_BUILD57_KO.md), and the [complete user specification](docs/SOLARIS_SPEC_KO.md). Prior build55/56 notes remain archived.

**No new database migration for build57.** An already working build56 Supabase setup is kept. New projects use `backend/001_solaris.sql`; existing build55 databases use the existing `backend/002_build56_broadcast_ready.sql`. Never delete account tables or disable RLS to solve an RPC setup error.

`UPLOAD_GIT_BASH.sh` uploads an isolated build57 review branch from the owner's verified build56 branch, preserving its Git history. It checks both the build56 and main heads, accepts an explicit extracted-source path, supports `--dry-run`, and uses an isolated Git index to exclude ignored local files and replace removed source files correctly. Nine local Git integration scenarios cover upload, history, exclusions, changed heads, source validation, dry run and rejected pushes. The owner's build56 branch already passed GitHub Actions; build57 CI still requires uploading this checkpoint. Official versions and signing keys remain under the owner's control.

```sh
npm ci --ignore-scripts
python3 scripts/prepare_unified.py
npm test
npm run test:database
node scripts/unified_ui_test.mjs
python3 -m unittest discover -s tests
python3 scripts/package_source.py
```

The source ZIP includes the full project, setup, uploader and continuation notes. Send a new source checkpoint before ending each work segment. Native installers/IPA generation and real cross-device media tests are separate from local compilation and automated logic/UI checks.

## Archived build54 transport notes

The original build54 notes below describe the old transport, not build57's verification status.

# Solaris 0.3.2 build54

Solaris shares screens peer to peer using Supabase for signaling. Current working target: Windows hardware H.264/Opus sender → iPad and Windows receiver at 1080p60, with iPad ReplayKit → Windows screen and app sound on its previously validated path. No Moonlight or Apollo installation is needed.

## build54 additions

- Fixes the build53 Android SDK setup failure by explicitly installing supported packages, without the obsolete `tools` default.
- Fixes native trickle ICE serialization (`candidate:` was missing), guarantees initial bundled host candidates are signaled, and records rejected candidates without aborting the SDP answer.
- The RTP room gate now removes embedded SDP candidates so a direct SDP success cannot hide a broken trickle signaling path. It retains two independent H.264/Opus receivers and isolated peer recovery.
- Android receiver APK project with **Windows 화면 받기** and **iPad 화면 받기**. Both reuse the matching build54 WebRTC receiver pages inside a secure-origin WebView. Android is a receiver in this build; Galaxy phone playback must be checked after Actions builds the APK.
- The Windows native sender allows up to five P2P viewer connections from one hardware encoder. The encoding load is shared, but each receiver has its own RTP/ICE peer and uses upload bandwidth. Five real-device 1080p60 streams are a goal, not an established result.
- Build52's room-signaling gate for two Windows browser receivers, H.264/Opus decode and recovery is retained in CI. It must pass along with the Android, Windows and iOS builds.

## GitHub Actions files

- `Solaris-Windows-Sender-build54`: extract all files and run `SolarisNativeHost.exe`.
- `Solaris-0.3.2-build54-integrated`: install the IPA using the existing re-signing process; the HTML receivers are also included.
- `Solaris-Android-Receiver-build54-debug`: APK for Galaxy device tests. This is a debug-signed test build, not a production release.
- Test evidence artifacts contain logs, not apps.

The source ZIP is for GitHub upload and cannot itself be installed. See [installation](docs/START_BUILD54_KO.md) and [validation boundaries](docs/BUILD54_VALIDATION.md).

## Platform scope and release gate

| Direction | Current state |
| --- | --- |
| Windows → iPad | build51 was confirmed by the user; retest build54 with other concurrent receivers |
| Windows → Windows | local Chrome RTP room test passed; Actions and physical device performance pending |
| Windows → Android | receiver APK compiled locally; Actions artifact and Galaxy playback pending |
| iPad/iPhone → Windows | existing ReplayKit path |
| iPad/iPhone → Android | receiver page reused; physical Galaxy playback pending |
| iPad/iPhone → multiple viewers | not implemented; ReplayKit sender has one peer |
| Android → other platforms | not implemented; native MediaProjection and system audio sender required |

The full four-platform, bidirectional five-viewer release also needs multi-peer iOS and Android senders, five-device stress tests, mixed-network recovery, room access controls, app signing and usable UI. Do not treat passing CI alone as that release gate.
