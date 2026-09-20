# Solaris 0.3.2 build28

iPad ReplayKit → WebRTC → Windows HTML. 무료 AltStore 재서명용 소스입니다.
Supabase 설정·기존 테이블·방 ID·ReplayKit sample-buffer 모드는 변경하지 않았습니다.

build24에서 H.264 VideoToolbox 1920×1324·60fps가 장시간 확인되었습니다.
build28은 최고화질 28–60Mbps 영상에 더해 ReplayKit의 **앱 소리만** Opus 48kHz 스테레오로
전송합니다. 마이크는 이 화면공유 트랙에서 읽거나 전송하지 않습니다.

## build28 변경

- 검증된 H.264 VideoToolbox와 최고화질 28–60Mbps 영상 정책 유지.
- ReplayKit `.audioApp`만 48kHz 스테레오 PCM으로 변환해 Opus 160–256kbps 트랙으로 전송.
- 불규칙한 20–25ms ReplayKit 콜백을 80ms 링 버퍼에 담고 WebRTC에 정확히 10ms씩 정속 공급.
- 짧은 입력 공백에는 무음을 공급하고 240ms 이상 누적되면 오래된 소리를 제거해 끊김과 지연 누적 방지.
- 오디오 버퍼 시간·언더런·오버런을 Windows 진단에 표시.
- `.audioMic`는 카운트만 하고 WebRTC에 전달하지 않음.
- Windows는 영상·오디오 `recvonly` 트랙을 같은 스트림에 붙여 재생하고, Opus stereo SDP를 요청.
- 화면 소리 트랙·코덱·수신 바이트·오디오 패킷 통계를 진단에 표시.
- IPA·HTML·아티팩트·앱 build 번호를 모두 28로 통일.

## 설치

소스를 압축 해제하고 해당 폴더에서 Git Bash로 bash UPLOAD_GIT_BASH.sh를 실행합니다.
GitHub Actions의 browser-test와 build 모두 성공 후
Solaris-0.3.2-build28-app-and-receiver를 다운로드합니다.
Solaris-0.3.2-build28-resign.ipa와 Solaris-Windows-0.3.2-build28.html을 함께 사용합니다.

[설치 안내](docs/STEP3_WEBRTC_SCREEN_KO.md) · [원인과 검증 범위](docs/BUILD20_VALIDATION.md)

## 검증

CI에서 Python 소스·패키징 검사, Python unittest, Node receiver tests,
Chromium 실제 영상 수신/재시작/품질 전달 검사, Swift 구성 검사와 Xcode IPA 빌드를 실행합니다.
마지막 IPA 빌드는 macOS/Xcode가 필요합니다. browser-test만으로 iOS 성공을 주장하지 않습니다.
실제 IPA·무료 재서명·기기 송출 성능은 별도 확인이 필요합니다.
