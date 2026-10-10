# build50 RTP browser gate

GitHub Actions run 38024333228 failed in `native-rtp-test` while awaiting H.264 video and Opus audio on two viewers. The native packetizer unit tests passed; Windows and iOS packaging did not run because the RTP gate failed.

Local reproduction with Playwright's bundled Linux Chromium returned `SDP answer: VideoIncompatible` from SIPSorcery. The browser's `RTCRtpReceiver.getCapabilities('video')` contained no H.264 codecs, and its answer rejected the offered video m-line (`m=video 0`). This makes the original gate invalid as a test of H.264 transport; it does not demonstrate a device throughput failure.

The interoperability gate now starts real Chrome and asserts H.264 capability before negotiating. Failure artifacts include both browser peer states, selected RTP statistics, SDP, errors, and native viewer snapshots. With Chrome 155 locally, the same test passed: H.264 and Opus decoded on two viewers; one viewer recovered after closing its peer while the other kept receiving frames.

Local checks: .NET 8 transport test project built, RTP unit tests passed, browser RTP integration passed, Python tests (40) and Node receiver tests passed. Windows WebView2/FFmpeg packaging, macOS Xcode build, iPad installation, hardware encode FPS, network conditions, and real multi-device playback still require GitHub Actions and device validation.
