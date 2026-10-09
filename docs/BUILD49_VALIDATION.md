# build49 Windows→iPad latency candidate

Windows FFmpeg used `BeginInvoke` to post every encoded frame to WebView2 on the UI thread, with no count or age bound before the data-channel queue. Under a busy UI thread, stale frames could queue while FFmpeg itself reported good output FPS. This build admits at most two whole access units to the UI queue, discards a frame if it has waited over 250ms, and resumes transmission on the next keyframe after a drop. This bounds that particular queue; it does not convert the stream to WebRTC RTP or prove end-to-end latency.

The Windows diagnostic now reports `hostQueueDrops`, `hostQueueDepth`, `encoderDrops`, `dataChannelBufferedBytes`, and `dataChannelAdmittedFPS` separately. Compare Windows and iPad diagnostics from the *same session* during motion. The iPad's completed access units and display-layer enqueue count are not a measure of actual screen presentation time.

The build48 Windows and iPad diagnostics received before this change had different session IDs. Windows reported a host-to-host UDP path, with the last 30 seconds showing an admitted rate near 60fps and roughly 7Mbps. The separate iPad session reported 39.6fps average and 65fps in the most recent interval, with zero incomplete-frame eviction and zero display-layer drops. The `availableOutgoingMbps` estimate was inconsistent with observed admission and must not be described as physical capacity.

Local source tests and packaging checks are required before publishing. GitHub Actions must compile Windows/iOS targets; real hardware is needed to confirm whether this queue limit improves latency and sustained receiver FPS.
