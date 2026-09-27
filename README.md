# Solaris 0.3.2 build40

Solaris is a two-person iPad/iPhone ↔ Windows screen-sharing probe. Signaling uses the existing Supabase table and media remains peer-to-peer through WebRTC.

## build40

- One iOS app: the existing Solaris app sends ReplayKit video and receives Windows video.
- One Windows sender: `SolarisNativeHost.exe` contains the Solaris sender UI.
- No separate Moonlight or Apollo application.
- Windows hardware mode uses WebCodecs H.264 Annex-B output over an unreliable WebRTC data channel.
- iPad renders that stream with `AVSampleBufferDisplayLayer`, backed by VideoToolbox.
- System audio remains an Opus stereo WebRTC track.
- Compatibility 1080p60 keeps the previous standard WebRTC video sender.

## Build outputs

- `Solaris-0.3.2-build40-integrated`: re-signing candidate IPA and the existing HTML receivers.
- `Solaris-Windows-Sender-build40`: self-contained .NET Windows sender. Windows 11's Edge WebView2 system component is used for capture permission and WebCodecs.
- `Solaris-build40-xcode-evidence`: diagnostics only when the iOS build fails.

## Test order

1. Install only `Solaris-0.3.2-build40-resign.ipa` on iPad.
2. Extract the Windows artifact and run `SolarisNativeHost.exe`.
3. On iPad, open **Windows 화면 받기** and start receiving.
4. On Windows, keep **Solaris 하드웨어 1080p60** selected and start sharing.
5. Select a monitor and enable system audio.
6. Copy Windows diagnostics and record the iPad FPS/Mbps/drop counters.
7. Try 1080p120 only after 1080p60 is stable and the PC produces at least 100 encoded FPS.

## Validation boundary

Local checks verify source structure and protocol framing. GitHub Actions must still compile the Windows and iOS targets. Device installation, actual hardware encoder selection, 60/120fps, audio, and network behavior are accepted only after physical-device diagnostics.

See `docs/STEP3_WEBRTC_SCREEN_KO.md` for Korean test instructions.
