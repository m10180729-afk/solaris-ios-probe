# build47 validation boundary

Windows→iPad hardware mode still uses a WebRTC data channel. This candidate prioritizes the last successful hardware encoder on bitrate restart and limits queued delta frames to 768KiB while allowing a whole IDR up to 2MiB. It adds a viewer identifier and iPad reception measurements to diagnostics. It does not implement RTP video or one-to-many P2P fanout.

Local checks cover source consistency, access-unit admission/recovery, and packaging. GitHub Actions must compile the .NET and iOS targets. Sustained 1920×1080 at 60fps, audio continuity, and motion latency require a real Windows and iPad session. Compare sender `nativeEncodedFPS`, `dataChannelBufferedBytes`, `adaptiveRestartCount` and receiver `recentCompletedFPS` under the same session; do not infer achieved FPS from capture settings.
