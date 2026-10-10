# build53 scope and checks

## Implemented

- Android receiver APK project (API 30+, Android System WebView): Windows native H.264/Opus RTP reception through the existing desktop receiver page; iPad ReplayKit reception through the existing screen receiver page. The app uses HTTPS WebViewAssetLoader and never requests a microphone or screen recording permission. The two receive modes are selected from the app's top buttons; one mode at a time.
- Windows native hardware encoder fan-out can now create five independent WebRTC RTP peers for five viewers. All five use the one encoder and separate P2P connections. Sender uplink demand scales with viewers. Existing two-Windows-receiver room signaling and isolated recovery integration gate is retained.

## Actual verification state

Local Python, JavaScript and .NET unit tests can check source, version and RTP packetization. This environment has no Android SDK or H.264 Chrome binary. The Android APK and Windows/iOS artifacts must be built by GitHub Actions; the Chrome room test must pass. These gates are compilation and local fixture tests, not a claim that five real devices sustain 1080p60. On-device WebView H.264/Opus interoperability, Supabase CORS, Galaxy playback, simultaneous Windows+iPad+Android reception, battery and network quality require testing.

## Still required for the stated full product goal

- iPad/iPhone ReplayKit sender currently serves one WebRTC peer; implement per-viewer connections or an SFU and test up to five.
- Android is receiver-only. Android screen/system-audio transmission needs MediaProjection, AudioPlaybackCapture, a hardware H.264 encoder and per-viewer WebRTC sender. That is a separate implementation and device validation task.
- Windows→Windows / Windows→iPad / Windows→Android 5-viewer sustained decode, disconnect/rejoin, mixed networks and TURN fallback must be checked. No server relay or Internet reliability guarantee is present.
- Secure room access, signaling retention, Android release signing, installation/distribution, UI and accessibility require work before a public release.

## Device test

After Actions succeeds, install `Solaris-Android-Receiver-build53-debug.apk` on the Galaxy phone. Install the matching IPA on iPad and extract the matching Windows sender artifact. Start one Windows 1080p60 broadcast, then join the same room with Android, iPad and Windows receivers. Capture diagnostics during at least two minutes of moving video with system sound. Disconnect one receiver and verify the others keep advancing. Repeat with up to five actual viewers when available; a Galaxy phone tests the Android client but cannot by itself prove a Galaxy Tab's high-resolution rendering or sustained thermals.
