# Solaris build52 validation

Build51 Windows→iPad screen sharing was confirmed by the user. Build52 focuses on the next target: Windows→Windows reception and two viewers watching one Windows sender. It keeps the validated hardware H.264/Opus RTP sender and adds an end-to-end room-signaling gate.

## New integration gate

`native-rtp-test` in GitHub Actions creates a local Supabase-compatible signaling fixture. Two real Chrome windows load the production `solaris-desktop.html`, invoke its Windows receive button handler, join the same room, exchange per-viewer SDP/ICE, and decode one H.264 1080p60 plus stereo Opus source. Each must sustain at least 54 decoded fps over ten seconds. The fixture then closes one viewer peer, verifies its watchdog recovers through the room messages, and verifies the second viewer kept the same connection and continued decoding. The earlier direct SDP test with large IDR frames remains as a separate gate. `build/rtp-diagnostics/result.json` or `failure.json` is uploaded as `Solaris-build52-rtp-test-evidence`.

Local evidence: the C# fixture compiled against the existing .NET reference assemblies and 18 RTP/audio/scheduling assertions passed; Python repository tests (40) and JavaScript syntax passed. Chrome with H.264 is unavailable locally, so the new end-to-end gate has **not** passed locally. GitHub Actions must run it, the Windows host publish/self-test, and Xcode build before using build52 artifacts. Physical Windows GPU capture, system audio, Windows→iPad plus Windows→Windows simultaneous playback, Internet NAT traversal, and four viewers still require device tests.

## Device check after Actions succeeds

1. Run the `Solaris-Windows-Sender-build52` artifact on the Windows sender. Use the `Solaris-0.3.2-build52-integrated` IPA on iPad; use its `Solaris-Desktop-Share-build52.html` on another Windows PC. Enter the same room in all three.
2. Select Solaris hardware 1080p60, enable system sound, start sharing, then select **Windows 화면 받기** on iPad and **다른 Windows 화면 받기** on Windows. Play moving 60fps video with stereo audio for two minutes.
3. Copy diagnostics from all three *during playback*. Match `session`; record each viewer's `viewerID`, `connectionID`, `fps`, `framesDecoded`, audio received, packet loss, and sender `viewers` list. Stop one receiver and reconnect it; the other should continue without replacing its peer. One encoder feeds separate P2P links, so sender upload rises with viewer count.

Do not interpret a requested 60fps or successful signaling as actual decoded 60fps. Use receiver frame counters and sound playback.
