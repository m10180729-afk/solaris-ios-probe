# Solaris build52 설치·테스트

소스 ZIP은 GitHub 업로드용입니다. Git Bash 업로드 후 Actions의 빌드가 성공해야 설치 파일을 받을 수 있습니다.

1. `Solaris-Windows-Sender-build52` artifact 전체를 압축 해제하고 `SolarisNativeHost.exe`를 실행하세요. 함께 든 파일을 지우거나 EXE만 옮기지 마세요.
2. `Solaris-0.3.2-build52-integrated` artifact의 `Solaris-0.3.2-build52-resign.ipa`를 기존 AltStore 방식으로 iPad에 설치하세요.
3. Windows에서 **Solaris 하드웨어 1080p60**을 선택하세요. 같은 방 ID를 입력하고 시스템 소리 포함 여부를 정한 뒤 송신을 시작합니다. 현재 주 모니터를 전송합니다.
4. iPad는 **Windows 화면 받기**, 다른 Windows PC는 **다른 Windows 화면 받기**를 누릅니다. 한 송신기에 최대 네 개의 시청자 슬롯이 있으나, 실제 네 기기 성능은 아직 검증하지 않았습니다.
5. 움직임이 많은 화면과 소리를 두 분 동안 재생하고, 공유를 중지하기 전에 Windows와 iPad 진단을 모두 복사하세요. `session`, `connectionID`가 같은 진단을 비교해야 합니다.

HTML 구분:
- `Solaris-Windows-0.3.2-build52.html`: iPad가 보낸 화면을 Windows에서 받는 기존 경로.
- `Solaris-Desktop-Share-build52.html`: Windows 화면공유 UI. GPU 송신은 Windows EXE 안에서 사용하세요. HTML을 브라우저에서만 열면 같은 네이티브 GPU 송신기가 실행되지 않습니다.

`rtp-test-evidence`, `xcode-evidence` 이름의 artifact는 진단자료이며 설치 파일이 아닙니다.

이번 빌드는 수신 버튼부터 방 참가·신호 교환·두 Windows 수신기의 동시 재생 및 한 시청자의 연결 복구까지 CI에서 확인하도록 검증 범위를 확장했습니다. CI 결과와 실제 기기 재생을 확인하세요.
