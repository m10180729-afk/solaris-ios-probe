# Solaris 0.4.0 build58

Authenticated cross-platform screen sharing and original-file P2P transfer, designed to accompany Discord. No voice calling.

This checkpoint restores the exact build54 Windows capture file and reuses the original ReplayKit capture pump in the unified iOS sender. The native Windows path returns to 1080p60, fast_bilinear and its original 12–18Mbps budget. See `docs/BUILD54_CAPTURE_REFERENCE.json` and run `python3 scripts/check_build54_capture.py` for the retrieved source hashes. Device FPS is not established by source equality.

Email/password signup and login, verified-email upgrade of existing UID accounts, password recovery, connected DM and server/channel views, scoped message history and Discord-style responsive navigation are implemented. Android uses capture lifecycle epochs, first-frame readiness, bounded H264 requests and capture/encoder statistics. Incoming screen and app-audio tracks share one playback stream even when their stream IDs differ or are missing. No quality picker is exposed.

Read [build58 setup](docs/START_BUILD58_KO.md), [verification and limits](docs/BUILD58_STATUS_KO.md), [continuation memo](docs/CONTINUE_BUILD58_KO.md), and [the complete specification](docs/SOLARIS_SPEC_KO.md). Earlier notes remain archived.

No new database migration for build58: existing working build56/57 setups are preserved. New projects use `backend/001_solaris.sql`; old build55 databases use the existing `backend/002_build56_broadcast_ready.sql`. Do not delete account tables or disable RLS to resolve setup failures. The email-code flows need Supabase email templates containing `{{ .Token }}`; real SMTP/auth delivery remains unverified.

`UPLOAD_GIT_BASH.sh` verifies the uploaded build57 branch and unchanged build54 main, then pushes an isolated build58 review branch. Official release approval and signing keys remain with the project owner. Tests exercise the uploader against real local Git remotes. Windows EXE and iOS IPA packaging require a successful new Actions run.

Automatic JavaScript, SQL, Android, C# and UI checks are documented separately from physical-device and actual-network testing. Do not treat build57 CI, a mocked auth endpoint or a one-gigabyte disk transfer as proof of build58 device performance or Internet P2P transfer.

The original build54 notes below describe the old transport, not build58's verification status.

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
