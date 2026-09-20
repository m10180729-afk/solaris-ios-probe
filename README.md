# Solaris 0.3.2 build26

iPad ReplayKit → WebRTC → Windows HTML. 무료 AltStore 재서명용 소스입니다.
Supabase 설정·기존 테이블·방 ID·ReplayKit sample-buffer 모드는 변경하지 않았습니다.

build24에서 H.264 VideoToolbox 1920×1324·60fps가 장시간 확인되었습니다.
build26은 빠른 화면 전환의 압축 뭉개짐을 줄이기 위해 최고화질 28–60Mbps를 기본값으로
사용합니다. 방송 중 안정형 20–60Mbps로 전환할 수 있고 750ms 수신 버퍼를 유지합니다.

## build26 변경

- 검증된 H.264 VideoToolbox와 level 5.1 협상을 유지.
- 기본 최고화질 28–60Mbps와 안정형 20–60Mbps를 Windows에서 선택 가능.
- ICE 연결 완료 시 송신 정책을 다시 적용해 초반 저화질 가능성 감소.
- QHD 업스케일 선택을 제거하고 ReplayKit 원본 1920급·60fps를 기본값으로 사용.
- 지원 브라우저에서 750ms 품질 우선 지터 버퍼 요청.
- 누적·최근 손실률, 10초 평균·최대 수신 Mbps, 버퍼 지연·RTT·가용 대역폭 진단.
- 최신 1프레임 대기열 유지, 중복된 시간 기반 프레임 제한 제거.
- 실제 송신 인코딩/바이트/FPS/제한 사유와 수신 통계 분리.
- App Group 대신 Windows offer/data channel로 품질 전달 및 요청 ID 확인.
- IPA·HTML·아티팩트·앱 build 번호를 모두 26으로 통일.

## 설치

소스를 압축 해제하고 해당 폴더에서 Git Bash로 bash UPLOAD_GIT_BASH.sh를 실행합니다.
GitHub Actions의 browser-test와 build 모두 성공 후
Solaris-0.3.2-build26-app-and-receiver를 다운로드합니다.
Solaris-0.3.2-build26-resign.ipa와 Solaris-Windows-0.3.2-build26.html을 함께 사용합니다.

[설치 안내](docs/STEP3_WEBRTC_SCREEN_KO.md) · [원인과 검증 범위](docs/BUILD20_VALIDATION.md)

## 검증

CI에서 Python 소스·패키징 검사, Python unittest, Node receiver tests,
Chromium 실제 영상 수신/재시작/품질 전달 검사, Swift 구성 검사와 Xcode IPA 빌드를 실행합니다.
마지막 IPA 빌드는 macOS/Xcode가 필요합니다. browser-test만으로 iOS 성공을 주장하지 않습니다.
실제 IPA·무료 재서명·기기 송출 성능은 별도 확인이 필요합니다.
