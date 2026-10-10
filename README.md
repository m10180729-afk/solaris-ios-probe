# Solaris 0.3.2 build51

Target: Windows→iPad and Windows→Windows, 1920×1080 at 60fps with system audio, no microphone. Solaris contains the Windows sender and iOS receiver; no Moonlight/Apollo installation is required. iPad→Windows ReplayKit sharing remains available.

## Current hardware60 path

- Windows: bundled FFmpeg captures the primary monitor, selects NVENC / Quick Sync / AMF / Media Foundation H.264 hardware encoding.
- One encoder feeds a separate SIPSorcery SRTP peer per viewer, up to four viewer slots. H.264 video and Opus stereo audio use standard RTP tracks. Supabase carries signaling only.
- iPad uses its native WebRTC receiver; Windows uses the integrated/browser WebRTC receiver.
- The browser compatibility sender can select software OpenH264 and is not the recommended performance test.
- The legacy DataChannel/120fps path is retained internally but hidden; build51 targets hardware60 only.

## build51 correction

The build50 hardware diagnostic showed connected peers and fresh RTCP while the sender discarded most video frames. A three-frame queue could reset while a large IDR was still being paced. build51 preserves prediction chains within a time/byte budget, retains a newer IDR suffix on overload, and paces across frames with bounded credit that tolerates coarse timers. Raw H.264 pipe arrival times no longer act as frame timestamps: explicit CFR output has a sequence-based media clock. This does not prove the capture source produces 60 distinct pictures each second.

See [validation and diagnostic interpretation](docs/BUILD51_VALIDATION.md).

## GitHub Actions outputs

- `Solaris-Windows-Sender-build51`: extract the entire artifact and run `SolarisNativeHost.exe` (keep bundled files together).
- `Solaris-0.3.2-build51-integrated`: install `Solaris-0.3.2-build51-resign.ipa` through your existing re-signing workflow. HTML receivers are also included.
- `Solaris-build51-rtp-test-evidence` and `Solaris-build51-xcode-evidence`: test/build logs, not apps.

The source ZIP must be uploaded to GitHub and built; it is not an installable Windows/iPad app.

## Device test

1. Use build51 on sender and receiver. Run the Windows sender and select **Solaris 하드웨어 1080p60**. Set the room and system-audio option, then start sharing.
2. iPad: **Windows 화면 받기**. Another Windows PC: **다른 Windows 화면 받기** in the same room.
3. Play continuous 60fps motion and sound for two minutes. Copy both diagnostics during sharing, before stopping. Match session, viewerID and connectionID.
4. Windows should report `native-rtp`, a GPU encoder, advancing `rtpFramesSent`, and no recurring `backlogRecoveries`. Compare iPad `rtpAverageDecodedFPS`/`rtpRecentFPS`, not legacy DataChannel counters. The first join may discard deltas until the next IDR.
5. Then try two receivers together and disconnect/rejoin one; the other should continue. Four physical viewers have not been validated.

## Verification boundary

Linux .NET scheduling tests and actual Chrome H.264/Opus SRTP interoperability have passed locally, including large IDRs and two viewers with recovery. GitHub Actions must run the Windows timer test, Windows publish/self-test, and Xcode iOS build. Actual Windows GPU capture, WASAPI audio, iPad rendering, end-to-end latency and sustained multi-device performance remain device checks. P2P upload usage grows with the viewer count; TURN and Internet-scale congestion control are not added in this build.
