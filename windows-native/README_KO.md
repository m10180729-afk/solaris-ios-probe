# Solaris Windows 통합 앱 · build62

Windows 단일 앱에서 친구/서버 채널을 선택해 **화면공유**, **화면공유 보기**, **파일 보내기**를 사용합니다. 기존 하드웨어 H264/다중 RTP 엔진을 재사용하며 마이크·음성통화는 없습니다. 방 코드와 별도 Python 수신기 없이 계정·친구 동의·채널 권한으로 연결합니다.

포터블 폴더 전체를 압축 해제하고 `SolarisNativeHost.exe`를 실행합니다. `ffmpeg.exe`를 같은 폴더에 둡니다. .NET8 런타임을 포함하며 WebView2가 필요합니다. 기존 앱이나 계정 저장소를 삭제하지 않습니다. 표준 창 테두리의 최소화·최대화·크기 조절, F11 전체화면과 Escape 복원을 사용할 수 있습니다. 하단 계정 영역과 설정의 내 계정에 로그아웃이 있습니다.

대화 메뉴의 연결 및 화면공유 상태에서 실제 FPS·해상도·RTT·손실·비트레이트와 제한된 로그를 확인하고 저장할 수 있습니다. 인증 토큰·SDP·ICE는 제거합니다. Windows build54 엔진/품질 정책 해시가 일치하며 실제 GPU·인터넷 성능은 별도로 확인해야 합니다. 설정은 [build62 시작 안내](../docs/START_BUILD62_KO.md), 결과는 [build62 상태](../docs/BUILD62_STATUS_KO.md)를 읽습니다.

---

아래 build54 안내는 유지된 이전 전송 경로의 기록입니다. 현재 통합 앱의 사용 흐름은 위 안내를 사용합니다.

# Solaris Windows 화면공유 · build54 기록

## 실행

1. Actions의 `Solaris-Windows-Sender-build54` 전체를 한 폴더에 압축 해제하고 `SolarisNativeHost.exe`를 실행합니다. `ffmpeg.exe` 등 동봉 파일을 함께 둡니다.
2. iPad에는 같은 빌드의 `Solaris-0.3.2-build54-resign.ipa`를 기존 방법으로 설치합니다.
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
