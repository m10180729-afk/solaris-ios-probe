# build36 — 상황별 화면공유 모드

## 목적

Windows 송신 환경마다 가능한 성능이 다른데도 하나의 1080p120 버튼만 제공하던 문제를 해결합니다.
브라우저의 120fps 요청값과 실제 캡처·인코딩 FPS를 혼동하지 않도록 모드를 분리합니다.

## 모드

- 1080p60 안정: 최대 60fps, 6–40Mbps, `maintain-framerate`.
- 1080p120 실험: 최대 120fps, 8–80Mbps, `maintain-resolution`.
- 1080p120 네이티브: Windows Graphics Capture와 NVENC/Quick Sync/AMF 기반 별도 엔진이 필요한 다음 단계. build36에서는 안내만 제공합니다.

## 판정

- OpenH264 또는 `powerEfficientEncoder=false`이면 하드웨어 인코딩 성공으로 판단하지 않습니다.
- 120fps 실험 성공은 실제 1920×1080 RTP가 목표 FPS의 92% 이상일 때만 표시합니다.
- 진단에는 선택한 모드, 캡처 설정, 실제 RTP, 캡처 FPS, 인코더 구현, 인코딩 시간과 네트워크 값을 함께 기록합니다.

## 보존 범위

iPad→Windows ReplayKit H.264 VideoToolbox 영상과 Opus 스테레오 화면 소리 경로는 변경하지 않습니다.
