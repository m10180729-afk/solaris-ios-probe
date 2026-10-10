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
