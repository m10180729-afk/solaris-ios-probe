# Solaris 0.3.2 build39

iPad ReplayKit → Windows와 Windows → iPad/Windows WebRTC 화면공유입니다. 무료 AltStore 재서명용 소스입니다.
Supabase 설정·기존 테이블·방 ID·ReplayKit sample-buffer 모드는 변경하지 않았습니다.

build24에서 H.264 VideoToolbox 1920×1324·60fps가 장시간 확인되었습니다.
build30은 최고화질 28–60Mbps 영상에 더해 ReplayKit의 **앱 소리만** Opus 48kHz 스테레오로
전송합니다. 마이크는 이 화면공유 트랙에서 읽거나 전송하지 않습니다.

## build39 변경

- Windows Actions가 공식 Apollo v0.4.6 GPLv3 엔진을 내려받아 `engine` 폴더에 포함.
- `Solaris-Native-Host-build39-portable`은 압축 해제 후 바로 실행하며 Apollo·winget 별도 설치가 필요 없음.
- iOS Actions가 공식 Moonlight iOS GPLv3 소스를 직접 빌드해 `Solaris-Native-Receiver-build39-resign.ipa`를 생성.
- App Store의 Moonlight 앱을 별도로 설치하지 않고 Solaris 이름의 네이티브 수신 IPA로 1080p120을 시험.
- upstream 커밋과 GPLv3 라이선스를 결과물에 함께 포함.
- GPU·드라이버·현재 해상도·주사율, 내장 엔진·설정 페이지 상태를 진단.
- 최초 방화벽 허용, 호스트 시작/중지, 설정 페이지 열기와 1080p120 시험 설정 복사를 한 화면에서 제공.
- `solaris-native://` 프로토콜을 등록해 Windows HTML의 네이티브 모드 버튼과 연결.
- 기존 Solaris 앱에서 외부 Moonlight 설치 링크를 제거하고 Solaris Native Receiver 안내로 교체.
- 엔진의 GPLv3 라이선스, 공식 소스 링크, 다운로드 자산 SHA256을 결과물에 포함.

## build36에서 유지하는 상황별 선택

- Windows 송신 화면을 `1080p60 안정`, `1080p120 브라우저 실험`, `1080p120 네이티브 안내`로 분리.
- 안정 모드는 60fps·6–40Mbps·프레임 유지 우선, 실험 모드는 120fps·8–80Mbps·해상도 유지 우선으로 각각 독립 적용.
- 실제 캡처·인코딩 통계를 기준으로 적합한 모드를 안내하고 OpenH264에서는 안정 모드를 권장.
- 아직 포함되지 않은 네이티브 GPU 송신 엔진을 브라우저 120fps와 혼동하지 않도록 명시.
- iPad 앱 첫 화면에서 Windows→iPad 수신과 iPad→Windows ReplayKit 송신을 상황별로 구분.

## build35에서 유지하는 Windows WebRTC 경로

- 실기기에서 확인된 build30 iPad→Windows H.264 영상과 stereo `renderBlock` 화면소리 경로를 유지.
- `Solaris-Desktop-Share-build39.html`에 Windows H.264 화면 송신과 다른 Windows 수신을 함께 제공.
- Xcode 16.4의 타입 지정 `RTCAudioSession.setCategory` API에 맞춰 iPad 수신기 컴파일 오류를 수정.
- Windows 송신은 1920×1080·120fps를 직접 요청하고 H.264 level 5.1, 80Mbps 상한, 해상도 축소 없음 정책을 적용.
- iPad answer도 H.264 level 5.1로 조정하고 20Mbps 시작·8Mbps 최소 힌트로 1080p 승격 지연을 줄임.
- 진단에서 OpenH264 CPU 인코더가 확인되면 GPU 인코더 미사용을 즉시 오류로 표시.
- Windows 화면의 시스템 오디오만 Opus 48kHz stereo로 전송하고 마이크는 요청하지 않음.
- iPad 앱에 네이티브 WebRTC/Metal Windows 화면 수신 화면과 실제 해상도·수신 FPS·Mbps 진단 추가.
- ReplayKit 반대 방향과 충돌하지 않도록 데스크톱 전송은 별도 `desktop-v1` 신호방 사용.
- 앱 본체와 방송 확장이 각각 자신의 `Frameworks/WebRTC.framework`를 링크·내장하는지 Xcode 프로젝트와 IPA에서 검사.
- Windows 페이지 정적 검사와 1080p120 송수신 정책 회귀 테스트 추가.

## build30에서 유지하는 검증된 경로

- 검증된 H.264 VideoToolbox와 최고화질 28–60Mbps 영상 정책 유지.
- ReplayKit `.audioApp`만 48kHz 스테레오 PCM으로 변환해 Opus 160–256kbps 트랙으로 전송.
- build29 진단에서 송신 PCM 84.6초 중 약 절반만 정상 Opus로 인코딩되고 43.7초가 수신기 무음 보정된 2:1 불일치를 확인.
- WebRTC의 pre-filled stereo 경로 대신 공식 `renderBlock` 경로를 사용해 프레임 수×2채널 전체 PCM을 전달.
- ReplayKit 콜백 하나를 변환 후 한 번만 전달하고, WebRTC 내부 `FineAudioBuffer`가 10ms 단위로 재구성.
- 실제 ReplayKit 콜백 길이를 WebRTC 오디오 장치에 통지하고 변환 형식 비교에서 구조체 패딩을 제외.
- Windows의 영상·오디오 수신 버퍼를 모두 750ms로 맞춰 A/V 동기화 보정에 의한 끊김 방지.
- 전달 콜백 수·최대 전달 간격·변환기 재설정 횟수와 브라우저 음성 은폐 샘플을 진단에 표시.
- `.audioMic`는 카운트만 하고 WebRTC에 전달하지 않음.
- Windows는 영상·오디오 `recvonly` 트랙을 같은 스트림에 붙여 재생하고, Opus stereo SDP를 요청.
- 화면 소리 트랙·코덱·수신 바이트·오디오 패킷 통계를 진단에 표시.
- IPA·HTML·아티팩트·앱 build 번호를 모두 31로 통일.

## 설치

소스를 압축 해제하고 해당 폴더에서 Git Bash로 bash UPLOAD_GIT_BASH.sh를 실행합니다.
GitHub Actions의 browser-test와 build 모두 성공 후
Solaris-0.3.2-build39-screen-modes, Solaris-Native-Host-build39-portable,
Solaris-Native-Receiver-build39을 다운로드합니다.
네이티브 시험에는 Windows portable 폴더 전체와 Solaris-Native-Receiver-build39-resign.ipa를 사용합니다.

[설치 안내](docs/STEP3_WEBRTC_SCREEN_KO.md) · [원인과 검증 범위](docs/BUILD20_VALIDATION.md)

## 검증

CI에서 Python 소스·패키징 검사, Python unittest, Node receiver tests,
Chromium 실제 영상 수신/재시작/품질 전달 검사, Swift 구성 검사와 Xcode IPA 빌드를 실행합니다.
마지막 IPA 빌드는 macOS/Xcode가 필요합니다. browser-test만으로 iOS 성공을 주장하지 않습니다.
실제 IPA·무료 재서명·기기 송출 성능은 별도 확인이 필요합니다.
