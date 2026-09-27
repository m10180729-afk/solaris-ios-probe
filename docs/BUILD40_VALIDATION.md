# Build40 validation

- Removed the separate Moonlight-derived iOS application job.
- Removed the bundled Apollo/Sunshine engine and settings UI.
- Added a single Solaris Windows sender executable hosting the integrated sender UI.
- Added WebCodecs H.264 Annex-B framing over an unreliable WebRTC data channel.
- Added an AVSampleBufferDisplayLayer/VideoToolbox-backed H.264 surface inside the existing Solaris iOS app.
- Kept the prior WebRTC RTP video path as a compatibility fallback.
- Kept system audio on the existing Opus WebRTC track.

Physical-device performance is not claimed until the build40 Actions jobs pass and diagnostics are collected from the target Windows PC and iPad.
