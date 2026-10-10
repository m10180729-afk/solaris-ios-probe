# Solaris 0.3.2 build53

Solaris shares screens peer to peer using Supabase for signaling. Current working target: Windows hardware H.264/Opus sender → iPad and Windows receiver at 1080p60, with iPad ReplayKit → Windows screen and app sound on its previously validated path. No Moonlight or Apollo installation is needed.

## build53 additions

- Android receiver APK project with **Windows 화면 받기** and **iPad 화면 받기**. Both reuse the matching build53 WebRTC receiver pages inside a secure-origin WebView. Android is a receiver in this build; Galaxy phone playback must be checked after Actions builds the APK.
- The Windows native sender allows up to five P2P viewer connections from one hardware encoder. The encoding load is shared, but each receiver has its own RTP/ICE peer and uses upload bandwidth. Five real-device 1080p60 streams are a goal, not an established result.
- Build52's room-signaling gate for two Windows browser receivers, H.264/Opus decode and recovery is retained in CI. It must pass along with the Android, Windows and iOS builds.

## GitHub Actions files

- `Solaris-Windows-Sender-build53`: extract all files and run `SolarisNativeHost.exe`.
- `Solaris-0.3.2-build53-integrated`: install the IPA using the existing re-signing process; the HTML receivers are also included.
- `Solaris-Android-Receiver-build53-debug`: APK for Galaxy device tests. This is a debug-signed test build, not a production release.
- Test evidence artifacts contain logs, not apps.

The source ZIP is for GitHub upload and cannot itself be installed. See [installation](docs/START_BUILD53_KO.md) and [validation boundaries](docs/BUILD53_VALIDATION.md).

## Platform scope and release gate

| Direction | Current state |
| --- | --- |
| Windows → iPad | build51 was confirmed by the user; retest build53 with other concurrent receivers |
| Windows → Windows | RTP room test in CI; physical device performance pending |
| Windows → Android | receiver APK source added; APK build and Galaxy playback pending |
| iPad/iPhone → Windows | existing ReplayKit path |
| iPad/iPhone → Android | receiver page reused; physical Galaxy playback pending |
| iPad/iPhone → multiple viewers | not implemented; ReplayKit sender has one peer |
| Android → other platforms | not implemented; native MediaProjection and system audio sender required |

The full four-platform, bidirectional five-viewer release also needs multi-peer iOS and Android senders, five-device stress tests, mixed-network recovery, room access controls, app signing and usable UI. Do not treat passing CI alone as that release gate.
