# Solaris 0.3.2 build23

iPad ReplayKit → WebRTC → Windows HTML. 무료 AltStore 재서명용 소스입니다.
Supabase 설정·기존 테이블·방 ID·ReplayKit sample-buffer 모드는 변경하지 않았습니다.

영상에서 확인한 증상은 build19의 연결 성공 + 영상 0바이트/0프레임입니다.
H.264-only 협상 회귀를 제거하고 대체 코덱을 복구했습니다. 영상만으로 인코더 내부의
실패 원인(프로파일·픽셀 포맷·드라이버 등)을 확정할 수는 없습니다.

## build20~21 변경

- 자동 모드에서 VP8 우선, 지원하는 다른 코덱은 모두 유지.
- H.264 경로에서 첫 영상이 오지 않으면 같은 세션 내 VP8 우선 1회 재협상.
- 실제 CRLF로 SDP 처리, 영상 대역폭 상한만 설정. 프로파일/레벨은 변조하지 않음.
- 60Mbps 상한 유지, 강제 최소/시작 비트레이트 제거.
- 최신 1프레임 대기열 유지, 중복된 시간 기반 프레임 제한 제거.
- 실제 송신 인코딩/바이트/FPS/제한 사유와 수신 통계 분리.
- App Group 대신 Windows offer/data channel로 품질 전달 및 요청 ID 확인.
- IPA·HTML·아티팩트·앱 build 번호를 모두 20으로 통일.

## 설치

소스를 압축 해제하고 해당 폴더에서 Git Bash로 bash UPLOAD_GIT_BASH.sh를 실행합니다.
GitHub Actions의 browser-test와 build 모두 성공 후
Solaris-0.3.2-build23-app-and-receiver를 다운로드합니다.
Solaris-0.3.2-build23-resign.ipa와 Solaris-Windows-0.3.2-build23.html을 함께 사용합니다.

[설치 안내](docs/STEP3_WEBRTC_SCREEN_KO.md) · [원인과 검증 범위](docs/BUILD20_VALIDATION.md)

## 검증

CI에서 Python 소스·패키징 검사, Python unittest, Node receiver tests,
Chromium 실제 영상 수신/재시작/품질 전달 검사, Swift 구성 검사와 Xcode IPA 빌드를 실행합니다.
마지막 IPA 빌드는 macOS/Xcode가 필요합니다. browser-test만으로 iOS 성공을 주장하지 않습니다.
실제 IPA·무료 재서명·기기 송출 성능은 별도 확인이 필요합니다.
