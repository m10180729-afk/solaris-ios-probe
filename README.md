# Solaris 0.4.0 build56 — recovery checkpoint

Solaris complements Discord with screen sharing and original-file P2P transfer on Windows, Android, iOS and iPadOS. This branch continues the verified build54 source; it is **not a fully validated cross-platform release**.

The unified app adds Supabase anonymous UID accounts, nicknames and private avatars, friend consent/blocking, direct sessions, owner-managed servers/channels, shared broadcast discovery, native capture adapters, multiple viewers, and disk-backed chunk transfer with resume and SHA-256. Build56 hardens commit/cancel races, manual/background/network pause and source reselection, native Android signaling outside the WebView, broadcast readiness and scope authorization, account recovery races, and bounded redacted logs. Microphones and voice calls are excluded. Build54 transport fixtures are retained for regressions.

Start with [build56 setup](docs/START_BUILD56_KO.md). New databases use `backend/001_solaris.sql`; existing build55 databases use the data-preserving `backend/002_build56_broadcast_ready.sql`. Enable anonymous Auth before trying accounts. Read [actual verification and open gates](docs/BUILD56_STATUS_KO.md), the [23-section requirements](docs/SOLARIS_SPEC_KO.md), and [continuation instructions](docs/CONTINUE_BUILD56_KO.md). The prior [build55 record](docs/BUILD55_STATUS_KO.md) is preserved.

## Development commands

```sh
npm ci
python3 scripts/prepare_unified.py
npm test
npm run test:database
node scripts/unified_ui_test.mjs
node scripts/unified_browser_test.mjs
node scripts/file_stream_test.mjs
node scripts/unified_browser_test.mjs --large
```

The browser integration uses real RTCPeerConnections, a canvas video fixture, and an isolated PostgreSQL permission layer. The file stream test uses injected ordered packets and real 1 GiB disk I/O; it is a separate check and never claims real-network transmission.

## Test artifacts

- Source checkpoint: `Solaris-0.4.0-build56-source.zip`, including the specification, setup and continuation notes. Send an updated source ZIP before ending each work segment.
- Android: `Solaris-Android-build56-debug.apk`, locally compiled with five native signaling JVM tests; physical-device testing pending.
- Windows: Actions is configured to produce `Solaris-Windows-build56-Setup.exe` with FFmpeg and a WebView2 bootstrapper. C# compilation and 18 engine checks passed separately; installer generation and Windows execution are pending.
- iOS/iPadOS: Actions is configured to produce `Solaris-0.4.0-build56-resign.ipa`. A valid common App Group must survive re-signing. Xcode compilation, new process-metrics tests, installation and ReplayKit on real devices are pending.

139 automated tests passed, plus isolated real-browser UI and 1 GiB disk/chunk checks. The disk test does not establish real-network transfer. GitHub writes currently return `403 Resource not accessible by integration`; the remote main remains build54 and the new Actions jobs have not run.

Workflows build review branches and do not publish an official release. The project owner retains merge, release, signing and database administrator authority. Direct P2P files are never uploaded to Supabase Storage; only restricted avatars use Storage. TURN traffic and offline storage are separate operating costs.

---

The original build54 notes below describe the old transport, not build56's verification status.

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
