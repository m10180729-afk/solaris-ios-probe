# Solaris 0.3.2 build40 — 단일 앱 통합 화면공유 시험

build40은 별도 Moonlight/Apollo 앱을 사용하지 않습니다.

## Actions에서 받을 파일

- `Solaris-0.3.2-build40-integrated`: iPad용 `Solaris-0.3.2-build40-resign.ipa`, 기존 iPad→Windows 수신 HTML
- `Solaris-Windows-Sender-build40`: Windows용 `SolarisNativeHost.exe`
- `Solaris-build40-xcode-evidence`: 빌드 실패 때만 확인하는 자료

## Windows → iPad 테스트

1. 기존 Moonlight 테스트 앱은 삭제합니다.
2. iPad에 `Solaris-0.3.2-build40-resign.ipa` 하나만 설치합니다.
3. Windows 아티팩트를 완전히 압축 해제하고 `SolarisNativeHost.exe`를 실행합니다.
4. iPad Solaris에서 `Windows 화면 받기` → `Windows 화면 수신 시작`을 누릅니다.
5. Windows에서 `Solaris 하드웨어 1080p60`을 선택하고 `Windows 화면 보내기`를 누릅니다.
6. 공유할 모니터와 시스템 오디오를 선택합니다.
7. 화면이 나오면 Windows의 `진단 복사` 결과와 iPad 화면에 표시된 FPS·Mbps·드롭 수치를 확인합니다.

## 모드

- Solaris 하드웨어 1080p60: 기본 권장, H.264 WebCodecs → WebRTC 데이터 채널 → iPad VideoToolbox
- Solaris 하드웨어 1080p120: 120Hz 이상 모니터와 충분한 GPU·네트워크가 있는 PC용
- 호환 1080p60: 기존 WebRTC RTP 영상 경로, 하드웨어 경로를 지원하지 않을 때 사용

시스템 소리는 기존 WebRTC Opus 스테레오 트랙을 유지합니다. 영상만 별도 Solaris H.264 경로를 사용합니다.

## 현재 검증 범위

소스 검사와 자동 테스트, GitHub Actions의 Windows/.NET 및 iOS/Xcode 빌드까지 통과해야 설치 후보가 됩니다. 실제 하드웨어 인코더 선택과 60/120fps는 PC GPU 드라이버와 iPad 실기기에서 진단으로 최종 확인합니다.
