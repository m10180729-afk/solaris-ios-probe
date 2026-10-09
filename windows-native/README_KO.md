# Solaris Windows 화면공유 · build48

Moonlight와 Apollo를 설치하지 않습니다. ZIP을 한 폴더에 압축 해제한 뒤 `SolarisNativeHost.exe`를 실행하면 됩니다. 함께 들어 있는 `ffmpeg.exe`는 Solaris가 Windows의 NVIDIA NVENC, Intel Quick Sync, AMD AMF 또는 Media Foundation H.264 인코더를 직접 사용하기 위한 내부 구성요소입니다.

## Windows → iPad

1. GitHub Actions의 `Solaris-Windows-Sender-build48`를 내려받아 압축을 풉니다.
2. `SolarisNativeHost.exe`를 실행합니다.
3. iPad에는 `Solaris-0.3.2-build48-resign.ipa` 하나만 설치합니다.
4. iPad Solaris에서 `Windows 화면 받기` → `Windows 화면 수신 시작`을 누릅니다.
5. Windows에서 기본값인 `Solaris 하드웨어 1080p60` → `Windows 화면 보내기`를 누릅니다.
6. 공유할 화면과 `시스템 오디오 공유`를 선택합니다. 네이티브 영상은 현재 Windows 주 모니터를 전송합니다.

1080p60이 안정적으로 동작하고 진단의 실제 인코더 출력이 100fps 이상이면 `Solaris 하드웨어 1080p120`을 시험하세요. `호환 1080p60`은 WebCodecs H.264가 없는 PC용 기존 경로입니다.

## 확인할 진단

- 코덱: `H264 Native`
- `nativeEncoder`: `NVIDIA NVENC`, `Intel Quick Sync`, `AMD AMF`, `Windows Media Foundation` 중 실제 선택값
- `videoTransport`: `webcodecs-h264`
- 인코더 출력 FPS
- `encoderDrops`
- `dataChannelBufferedBytes`
- `adaptiveTargetMbps`, `adaptiveRestartCount`
- `awaitingKeyFrame`와 `resyncDrops`
- iPad 화면의 `VideoToolbox 표시 프레임`과 `손실/지연 드롭`

이번 버전은 큐 포화가 지속될 때 H.264 인코더를 더 낮은 비트레이트로 다시 시작합니다. 재시작 중 화면이 잠깐 멈출 수 있습니다. 송신을 중지한 뒤에도 `진단 복사`에서 마지막 세션의 통계를 볼 수 있습니다. 60fps 안정 확인을 우선하세요.
