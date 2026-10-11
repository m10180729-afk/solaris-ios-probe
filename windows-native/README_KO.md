# Solaris Windows 통합 앱 · build56

Windows 단일 앱에서 친구/서버 채널을 선택해 **화면공유**, **화면공유 보기**, **파일 보내기**를 사용합니다. 기존 하드웨어 H264/다중 RTP 엔진을 재사용하며 마이크·음성통화는 없습니다. 방 코드와 별도 Python 수신기 없이 계정·친구 동의·채널 권한으로 연결합니다.

Actions는 FFmpeg/WebView2를 포함한 `Solaris-Windows-build56-Setup.exe` 생성을 구성합니다. **현재 설치 EXE는 생성·실행 검증 전**입니다. 전체 C# 컴파일/엔진 18개만 로컬에서 통과했습니다. 실제 GPU 인코딩/수신/최소화 장시간 방송·파일/재실행을 확인해야 합니다.

진단은 버전/OS·연결/RTT·손실·지터·실제 FPS·비트레이트·파일/오류·제한된 로그를 포함하고 인증 토큰·SDP·ICE를 제거합니다. 설정은 [build56 시작 안내](../docs/START_BUILD56_KO.md), 결과는 [build56 상태](../docs/BUILD56_STATUS_KO.md)를 읽습니다.

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
