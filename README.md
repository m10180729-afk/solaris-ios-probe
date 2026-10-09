# Solaris 0.3.2 build48

Solaris currently supports a single sender and a single receiver per session. Signaling uses the existing Supabase table and media remains peer-to-peer through WebRTC.

## build48

The build47 Windows sender diagnostic reported a WebRTC candidate-pair estimate of 0.1–0.26Mbps and RTT spikes over one second. It dropped 487 access units and restarted the Intel encoder twice. The sender report alone does not establish the physical network capacity or the iPad's received FPS.

- Refresh the iPad H.264 format description when the SPS/PPS changes after an encoder restart, flushing the old display layer before enqueuing the new stream.
- Report the selected ICE candidate types and protocol without copying device IP addresses; highlight an unusable estimated route. Reset the displayed encoder FPS while FFmpeg is stopped or adjusting.
- This does not replace the native data-channel transport with RTP. It cannot guarantee 1080p60 on a route whose usable throughput is below the encoded video rate. Compare the iPad receiver diagnostic for the same session before attributing all stalls to the sender.

This is a latency candidate for Windows→iPad, not the planned RTP/multi-viewer release. The hardware path still uses a WebRTC data channel and can interrupt playback when bitrate changes restart FFmpeg.

- After the first hardware encoder succeeds, bitrate restarts try that encoder first. This avoids probing a known failing GPU again on every adjustment.
- Non-key access units are admitted only below a 768KiB queue budget. Complete keyframes retain a 2MiB budget for recovery. An over-budget frame is dropped whole, and dependent frames wait for a keyframe.
- Receiver diagnostics include a viewer identity and recent completion FPS for later multi-viewer work. One active viewer is still supported.

- Fix adaptive restart at 4Mbps: the Windows encoder now accepts the 4Mbps target and 6Mbps peak instead of throwing a reversed `Math.Clamp` bound error. The Windows self-test checks this exact case.
- One iOS app: the existing Solaris app sends ReplayKit video and receives Windows video.
- One Windows sender: `SolarisNativeHost.exe` contains the Solaris sender UI.
- No separate Moonlight or Apollo application.
- Windows hardware mode captures the primary monitor through bundled FFmpeg and tries NVENC, Quick Sync, AMF, then Media Foundation H.264 before sending Annex-B over an unreliable WebRTC data channel. The sender admits or drops each whole frame under a 768KiB delta-frame / 2MiB keyframe queue cap and requests a one-second keyframe interval to bound recovery after packet loss.
- Hardware 1080p60 now starts at 12Mbps with an 18Mbps burst cap. Sustained queue congestion reduces the encoder target toward 4Mbps; only a prolonged quiet period raises it, up to 28Mbps. Each change restarts the encoder and resumes from a keyframe. This trades transient clarity for a better chance of continuous playback on a constrained link.
- After queue saturation, delta frames are discarded until the next keyframe. This prevents an incomplete prediction chain from being displayed after congestion.
- iPad renders that stream with `AVSampleBufferDisplayLayer`, backed by VideoToolbox.
- Diagnostics report native encoder FPS plus iPad recent/average completed-frame FPS and receive Mbps. Windows also retains the last session diagnostics after stopping.
- System audio remains an Opus stereo WebRTC track.
- Compatibility 1080p60 keeps the previous standard WebRTC video sender.

## Build outputs

- `Solaris-0.3.2-build48-integrated`: re-signing candidate IPA and the existing HTML receivers.
- `Solaris-Windows-Sender-build48`: self-contained .NET Windows sender with its bundled FFmpeg hardware H.264 engine. No separate streaming app is installed.
- `Solaris-build48-xcode-evidence`: diagnostics only when the iOS build fails.

## Test order

1. Install only `Solaris-0.3.2-build48-resign.ipa` on iPad.
2. Extract the Windows artifact and run `SolarisNativeHost.exe`.
3. On iPad, open **Windows 화면 받기** and start receiving.
4. On Windows, keep **Solaris 하드웨어 1080p60** selected and start sharing.
5. Select a monitor and enable system audio.
6. Copy Windows diagnostics and use **Windows→iPad 수신 진단 복사** on iPad; the Windows report does not claim to measure iPad decoding/display.
7. Compare `adaptiveTargetMbps`, `adaptiveRestartCount`, queue drops, and the iPad's recent completed FPS under the same session ID. 1080p120 remains experimental.

## Next architecture step

The current `active` peer and native H.264 data channel are single-receiver. Multi-viewer sharing requires a separate peer connection per viewer while sharing one capture/encode pipeline. In a zero-cost P2P fanout, outgoing bandwidth increases per viewer; do not claim stable 1080p60 for multiple viewers until both upload capacity and all receiver FPS values are measured. Windows, iPad, and future platforms should use the same 1080p60 target with automatic degradation when the link cannot sustain it.

## Validation boundary

Local checks verify source structure and protocol framing. GitHub Actions must still compile the Windows and iOS targets. Device installation, actual hardware encoder selection, sustained 60fps, audio, and network behavior are accepted only after physical-device diagnostics. Adaptive restarts can briefly interrupt the picture; this release does not add multi-viewer delivery.

See `docs/STEP3_WEBRTC_SCREEN_KO.md` for Korean test instructions.
