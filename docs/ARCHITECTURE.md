# 이전 버전 설계 기록

0.3.1의 화면 송신/수신 변경은 README와 STEP3_WEBRTC_SCREEN_KO.md를 우선합니다.
이 문서의 LAN/2A 절차는 현재 앱 사용 절차가 아닙니다.

# Probe 1A: intentionally limited capture path

The SwiftUI container app writes a validated RFC1918 IPv4 endpoint and a per-run
token to an App Group. The user starts Apple's system broadcast picker manually.
The ReplayKit Upload Extension reads the shared configuration, observes raw sample
buffers and posts JPEG previews to the Windows Python receiver. A browser polls
that receiver on the same origin. No media cloud, signaling service or WebRTC is
part of this first test.

Preview is capped at one in-flight frame, at most 5 fps, long edge <=720 pixels.
Source callback count and source dimensions are reported separately. Neither is
proof of encoder throughput, actual display frame rate or network latency.
The original iPad aspect ratio is retained; this is not 1280x720 video.
Audio samples are counted and discarded. No sound is transmitted or recorded.

## Signing gate

Both targets request `group.org.solaris.probe`. A sideloading tool may rewrite the
bundle IDs and App Group ID. The app discovers the embedded extension's actual
bundle identifier. Both targets prefer Solaris group identifiers read from their
own installed provisioning profile. Container lookup alone is not proof of
working access: writing/reading config and extension stats is the actual check.

macOS CI builds with device SDK but without an Apple signing identity, then adds
ad-hoc signatures carrying requested entitlements. This is metadata preservation
for the re-signer, not a way to grant restricted capabilities. AltStore still needs
to provision and sign both targets for the user's device. Never remove the broadcast
extension to make an installation appear successful.

If App Groups fail under the actual account/OS/tool combination, this architecture
is blocked. It does not establish that all conceivable ReplayKit designs are
impossible. Pause, report the error and evaluate alternatives before more features.

## Threat boundaries

The diagnostic endpoint is plain HTTP and only accepts RFC1918/loopback clients,
matching Host/Origin, a per-run 256-bit token, bounded frame sizes and validated
metadata. It refuses overlapping active senders. The Swift network clients and
browser fetches do not follow redirects. Tokens stay out of URLs and request logs.
Stale screen bytes are discarded from receiver state after three seconds;
in-flight responses/browser memory may briefly retain bytes until released.
No screen file is written. App Group config (including the temporary token) and
non-image diagnostic stats do persist inside the application container.

This is not production-grade network isolation or protection against a hostile
LAN. Do not expose it to the internet, bypass a firewall, install unknown profiles,
or use it on shared public Wi-Fi. Production WebRTC must use its encrypted media
transport and authenticated signaling. Treat final privacy/security tests as an
additional review, not the first time security is added.

## References checked for this preparation

- [Apple ReplayKit](https://developer.apple.com/documentation/replaykit)
- [Apple broadcast sample handler](https://developer.apple.com/documentation/replaykit/rpbroadcastsamplehandler)
- [Apple system broadcast picker](https://developer.apple.com/documentation/replaykit/rpsystembroadcastpickerview)
- [XcodeGen project specification](https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md)
- [AltStore Windows installation](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows)
- [AltStore expiration and account limits](https://faq.altstore.io/altstore-classic/your-altstore)
- [GitHub runner availability](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

Documentation describes APIs/tools, not tested compatibility of this project on
iOS/iPadOS 27. Dependencies and hosted runner images can change; CI logs must be
retained with the device test record.
