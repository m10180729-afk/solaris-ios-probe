# build51 — RTP scheduling correction

## Evidence from the supplied build50 reports

These were two Windows sender runs, not opposite ends of one session.

| Observation | Interpretation / limit |
|---|---|
| Native session `dce4d27e-e85e-499e-bc42-ef0e3d7844c9`: Quick Sync kept producing; peer/ICE connected, RTCP fresh; RTP progress much slower; 3,928 queued/gated drops | The active sender discarded frames before network delivery. No evidence in this run that ICE disconnection caused the low FPS. |
| Native `awaitingKeyFrame` repeatedly true while the queue is empty | Consistent with discarding dependent frames after a local queue reset. The old code resets at three pending frames. Actual IDR byte sizes were not recorded, so the original exact burst size is unknown. |
| Native recent input exceeds 100fps despite 60fps target | Pipe delivery can batch; this is not proof of >60fps capture. The old code stamped each AU with pipe-arrival wall time, compressing media time during bursts. |
| Compatibility session `40cc8ed9-c053-483d-9ced-b81db82e86c4`: OpenH264, low capture/encode FPS, earlier bandwidth limitation | Separate software/browser path. Changing its bitrate cannot repair native RTP scheduling. |
| Reported Windows receiver FPS is updated via heartbeat | It may be several seconds older than the adjacent sender sample. build51 exposes that age; use matching session/connection iPad diagnostics too. |

## Implemented correction

Keep hardware H.264 + native SRTP (one peer per viewer). Do not route hardware video through the old DataChannel or browser OpenH264.

1. Replace the three-frame gate with `VideoBacklog`: pending work is bounded by 400ms arrival age and estimated wire bytes at the pacer rate. A frame-count safety limit remains only as a memory bound. A normal large IDR can drain while its dependent deltas wait. Real overload drops a broken chain; a newer IDR suffix is retained if it fits, otherwise deltas wait for the next periodic IDR. No arbitrary delta-frame skipping.
2. `PacketPacer` shares elapsed-time credit across AUs and retransmissions. Maximum burst credit is 20ms. Timer overshoot earns only bounded credit; no busy spin or unbounded catch-up. Repairs are serviced in bounded batches so NACK traffic cannot indefinitely starve new frames. Encoder target 12Mbps / peak18Mbps and pacer18Mbps are unchanged.
3. FFmpeg explicitly emits CFR (`-r`, `-fps_mode cfr`) and flushes output packets. Every AU gets a distinct sequence-based media timestamp, independent of batched pipe reads. This creates a correct encoded-stream timeline; it does not measure distinct captured pictures or remove a slow GPU/capture source.
4. Sender diagnostics add input count, keyframe bytes, queue bytes/age, overload recovery count, last reset reason, pacing overshoot, actual send duration, and receiver-report age. Media-clock offset is *not* measured end-to-end latency. iPad adds RTP average FPS, statistics age, cumulative jitter-buffer average and decode time; counters reset on peer replacement.
5. Existing bounded receiver stall/ICE recovery and per-viewer replacement remain. Encoder restart stays reserved for absent encoder output, not ordinary network/queue overload. Tests verify one receiver can recover while the second keeps decoding.

Pending-queue budget excludes one in-flight AU; it is not a 400ms end-to-end guarantee. No automatic link-capacity controller or TURN service is introduced here. Upload still scales per P2P viewer.

## Local verification (2026-10-10)

- .NET 8 Release transport/tests build: zero errors and warnings. Includes compilation of `NativeH264Capture.cs`, not the complete Windows Forms app.
- Deterministic 16ms timer simulation, 420KB IDRs every 0.5s and 15KB deltas: 540/540 frames sent, maximum pending queue11, no queue reset/drop. Actual overload/expiry tests gate deltas and resume only on a valid IDR.
- Actual Linux OS timer pacer: approximately18.17Mbps for an18Mbps target. Windows runs the same real-timer check in Actions.
- Real Chrome155, two receivers, H.264/Opus SRTP: both sustained60fps over a12-second measured window. Valid SEI data enlarges IDRs to421,487bytes to stress transport without changing the picture. Maximum per-AU send time was about183ms; the old three-frame allowance at60fps was only50ms. This directly exercises the newly fixed scheduling case.
- No backlog overload recoveries in that measured window. Startup/PLI gating may discard frames and is counted separately; cumulative `queueDrops` is not claimed to be zero.
- Forced disconnection of one viewer caused production receiver watchdog recovery; the other viewer continued. No DataChannel media m-line.
- Python40 tests, Node screen/desktop suites, source/plist checks passed.

Synthetic test video and Opus tones verify interoperability and pacing, not Windows capture quality, WASAPI source audio or iPad display. Test performance summary is in `BUILD51_TEST_RESULTS.json`.

## Actions gates and remaining device checks

1. Ubuntu: build transport, unit/scheduling tests, Chrome H.264/Opus large-IDR/two-viewer throughput and recovery. Failure artifact includes codec negotiation, native snapshots and logs.
2. Windows: real-timer pacing test, Windows publish, bundled FFmpeg, host self-test. These Windows-only steps were **not run locally**.
3. macOS: Xcode compile/package of the updated Swift receiver. **Not run locally**.
4. Hardware test: same build51 on both devices; hardware1080p60, continuous60fps motion plus audio for two minutes. Copy both reports while sharing, then add a second viewer and test rejoin. Confirm `native-rtp`, GPU encoder, advancing RTP counters and stable decoded FPS. Four-device stability and actual end-to-end latency remain unverified.

## Primary references

- Microsoft Task.Delay timing remarks: https://learn.microsoft.com/dotnet/api/system.threading.tasks.task.delay — sub-clock delays can be about15ms on Windows; local timer behavior must be measured.
- FFmpeg CFR/`-r`: https://ffmpeg.org/ffmpeg.html ; output flushing: https://ffmpeg.org/ffmpeg-formats.html . CFR may duplicate/drop input frames; requested60fps is not evidence of60 distinct captures.
- Previous build50 browser codec gate correction: `BUILD50_VALIDATION.md`.
