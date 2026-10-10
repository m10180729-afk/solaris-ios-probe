# build54: CI failure fixes and verification

## Confirmed causes

The screenshots from GitHub Actions run `38048669722` show two independent failures:

1. `android-actions/setup-android@v3` defaults to `tools platform-tools`. Google's SDK repository no longer supplies `tools`, so setup failed before Java compilation. The workflow now explicitly installs `platform-tools platforms;android-35 build-tools;35.0.0`. The same packages were found in the official SDK repository and installed locally.
2. The production room RTP test timed out. Reproducing build53 showed both receivers stuck in `have-remote-offer`, with zero frames and an `addIceCandidate` parsing error. Native SIPSorcery candidates were serialized as `343... 1 udp ...`, without the required `candidate:` prefix. Applying early ICE threw before creating/sending the answer. Direct SDP tests passed because SDP-embedded candidates already had the correct syntax.

This is a signaling interoperability defect, not evidence that the test PC cannot encode video at the target rate.

## Changes

- Serialize complete ICE attributes in the Windows RTP library. Deduplicate candidates, replay already gathered SDP candidates after creating an offer, and continue forwarding later trickle events. This also covers gathering before the caller subscribes to the signaling event. The sender uses a bundled transport; its initial candidates target m-line zero.
- Isolate a rejected trickle candidate from answer creation. The browser records candidate receive/apply/reject counters and the last rejection reason in diagnostics. Existing per-viewer stalled-media recovery remains active.
- The production room fixture strips SDP-embedded candidates and uses actual native candidate signaling. The gate requires accepted trickle candidates, zero candidate rejections, two H.264/Opus receivers, sustained decoded FPS and isolated recovery. It inspects the original signaled SDP; browser `remoteDescription` can acquire candidates after `addIceCandidate`.
- Failure evidence now includes room peer snapshots and the local fixture's signal payloads, in addition to browser state and logs.
- Explicit Android SDK packages; build identifiers, generated Android HTML, IPA/EXE/APK labels and source ZIP all use 54. Generated Gradle caches, APKs and local SDK settings are excluded from the source ZIP.

## Actual local verification

- .NET transport and fixture project compilation: passed, zero errors/warnings.
- Windows host cross compilation from Linux: passed, zero errors; existing WebView2 `WindowsBase` reference and unused-variable warnings remain. The Windows executable was not run here.
- Actual Chrome H.264/Opus RTP integration: passed. Two production room receivers each decoded about **59.95fps** during the ten-second sustained interval, with trickle ICE applied and no candidate rejection. One room receiver was disconnected and replaced; the other kept its peer and continued decoding. The direct SDP test also retained large IDRs and twelve-second sustained decode. Audio RTP reception was checked; listening quality was not tested on devices.
- Android `:app:assembleDebug`: passed using JDK 17, SDK 35, Build Tools 35.0.0, Gradle 8.11.1 and the project's actual dependency versions. The APK was built but not installed/executed on a Galaxy device.
- Python project tests: 40 passed; existing receiver tests: 9 passed.
- JavaScript desktop tests: 14 passed, including the malformed early candidate case; screen receiver tests: 19 passed. Syntax and shell checks passed.
- Machine-readable fixture results: [BUILD54_TEST_RESULTS.json](BUILD54_TEST_RESULTS.json).

## GitHub Actions and device checks still required

Run the matching build54 workflow and confirm all five jobs succeed: `native-rtp-test`, `windows-native`, `browser-test`, `android-receiver`, `build`. Xcode/iOS compilation, signing and installation were not performed locally. Windows runtime/self-test must pass on the Actions Windows runner.

Then use the build54 artifacts, join the same Windows broadcast from iPad, Windows and Android, and verify motion, system sound, stopping/rejoining and unaffected viewers. This local two-browser gate does not prove simultaneous five-physical-device 1080p60 or Internet/NAT connectivity.

Android remains receiver-only. The iPad ReplayKit sender still has one peer. Four-platform bidirectional five-viewer sharing and public release are not complete in this build.

## Primary references

- Android action packages and obsolete tools: https://github.com/android-actions/setup-android#additional-packages
- v3 action inputs (default includes tools): https://github.com/android-actions/setup-android/blob/v3/action.yml
- WebRTC candidate attribute grammar: https://www.w3.org/TR/webrtc/#candidate-attribute-grammar
