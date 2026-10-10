# Solaris Windows 화면공유 · build53

## 실행

1. Actions의 `Solaris-Windows-Sender-build53` 전체를 한 폴더에 압축 해제하고 `SolarisNativeHost.exe`를 실행합니다. `ffmpeg.exe` 등 동봉 파일을 함께 둡니다.
2. iPad에는 같은 빌드의 `Solaris-0.3.2-build53-resign.ipa`를 기존 방법으로 설치합니다.
3. Windows에서 **Solaris 하드웨어 1080p60**, 방 ID, **시스템 소리 포함**을 확인하고 송신을 시작합니다. 현재 주 모니터와 기본 재생 장치 소리를 공유합니다. 마이크는 포함하지 않습니다.
4. iPad의 **Windows 화면 받기**, 또는 다른 Windows의 **다른 Windows 화면 받기**에서 같은 방으로 들어갑니다.

Moonlight/Apollo는 설치하지 않습니다. 이번 목표는 1080p60입니다. 호환 모드는 CPU 인코딩을 사용할 수 있으므로 이번 수정 검증에는 하드웨어 모드를 사용하세요.

## 진단

공유 중 Windows와 iPad에서 모두 복사하세요. session과 connectionID가 같은지 확인합니다.

- `videoTransport`: `native-rtp`
- `encoderImplementation`: 실제 NVENC / Quick Sync / AMF / Media Foundation
- `nativeEncodedFPS`: 인코더 파이프에서 도착한 프레임 속도. 순간 100fps 이상이어도 120fps 캡처의 증거가 아닙니다.
- `viewers[].rtpSendFPS`, `rtpFramesSent`: 실제 RTP 송신 진행
- `backlogRecoveries`, `waitingKeyDrops`, `lastQueueReset`: 대기열 폐기 원인
- `lastKeyFrameBytes`, `lastSendDurationMilliseconds`, `queueOldestMilliseconds`: 큰 키프레임과 대기 시간
- `receiverReportAgeMilliseconds`: Windows에 표시한 수신 FPS 보고의 나이
- iPad `rtpAverageDecodedFPS`, `rtpRecentFPS`, `rtpStatsAgeMilliseconds`: 디코딩 속도와 진단 시점

대기열 복구는 새 키프레임에서 시작하며, 수신 정지는 기존 수신기 감시기가 감지해 해당 시청자 연결만 재생성합니다. 완전한 해결 판정은 실제 기기 진단 후에 합니다.
