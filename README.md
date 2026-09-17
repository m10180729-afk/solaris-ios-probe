# Solaris — 3A WebRTC 화면공유 시험 프로젝트

현재 상태: **ReplayKit → WebRTC 화면 송신 소스 준비 / iOS 빌드·무료 서명·실기기 송출 미검증**.
이 ZIP은 완성 앱이나 바로 설치할 IPA가 아닙니다. 구체적인 로컬 검사 결과는 `docs/VALIDATION.md`에서 확인하세요.

## 이번에 확인하는 것

1. 무료 Apple 계정으로 본체 앱과 ReplayKit 방송 확장을 함께 설치할 수 있는가?
2. 앱과 확장이 App Group(공유 설정 공간)을 실제로 읽고 쓸 수 있는가?
3. 다른 앱을 열어도 iPad 화면이 같은 집의 Windows PC에 전달되는가?
4. 화면 회전, 방송 종료·재시작이 정상인가?

**이번 미리보기는 긴 변 최대 720픽셀, 최대 5fps, 음성 전송 없음**입니다.
720p 영상이나 1080p60 WebRTC 구현이 아닙니다. 마이크·앱 오디오는 콜백 횟수만 기록합니다.
일반 통화, 다른 집과의 연결, Windows 화면 송출, 채팅, 자동 재연결, EXE/APK는 아직 구현하지 않았습니다.
1단계가 통과하기 전에는 이 기능들을 개발하지 않습니다.

## 지금 할 일

밖에 있다면 이 파일만 보관하세요. 집에 가면 `docs/START_HERE_KO.md`부터 읽으세요.

- 필요한 것: Windows PC, iPad, 데이터 연결 가능한 USB 케이블, 신뢰하는 집 Wi-Fi.
- 계정: 무료 GitHub 계정(클라우드 빌드), 일반 Apple 계정(내 PC에서 직접 서명).
- Mac을 소유할 필요는 없지만 **컴파일에는 macOS/Xcode 환경이 필요**합니다. GitHub 표준 macOS 실행 환경을 후보로 준비했습니다.
- 저장소 공개, 계정 가입, 빌드 실행, 외부 업로드는 수행하지 않았습니다. 공개 여부는 먼저 결정해야 합니다.
- Apple 비밀번호·인증번호·복구 키는 ChatGPT, GitHub 코드, Actions 비밀변수에 넣지 마세요.

## 파일 구성

| 경로 | 역할 |
| --- | --- |
| `ios/App/` | 연결 설정과 Apple 방송 시작 버튼을 보여 주는 시험 앱 |
| `ios/Broadcast/` | 다른 앱을 사용하는 동안 화면을 받는 ReplayKit 확장 |
| `ios/Shared/` | LAN 주소 검증, App Group 설정·통계 공유 |
| `ios/Config/` | 앱·확장 공통 권한 요청 |
| `ios/project.yml` | XcodeGen 프로젝트 생성 설정 |
| `receiver/` | Python 수신기, PC 브라우저 미리보기, 자동 테스트 |
| `scripts/` | 구조 검사, macOS 빌드, 소스 압축 도구 |
| `tests/` | macOS에서 실행할 Swift 설정 검증 |
| `.github/workflows/` | 수동 실행만 가능한 클라우드 빌드 절차 |
| `docs/` | 초보자 설치 안내·검증 결과·실기기 기록표 |

기존 로고 원본을 앱 안에만 사용했습니다. 아이콘 단순화·정식 홈 화면 아이콘·완성 UI는 후속 단계입니다.

## 안전과 비용

- 임시 토큰을 알아야 화면을 보낼 수 있고 볼 수 있습니다. 화면은 PC 메모리에만 두며 파일로 저장하지 않습니다.
- **LAN 시험은 HTTP 평문입니다. 토큰은 암호화가 아닙니다.** 공공/학교 Wi-Fi, 인터넷 노출, 포트포워딩에 사용하지 마세요.
- 화면에는 알림·개인정보가 보일 수 있습니다. 집중 모드를 켜고 민감한 앱을 열지 마세요.
- PC 미리보기 창을 닫아도 iPad 방송은 별도로 종료해야 합니다.
- App Group 접근 실패는 이 시험 구조의 장애입니다. ReplayKit 전체가 무료 계정에서 원천 불가능하다는 증거로 단정하지 않습니다. 정확한 오류를 보고 다음 대안을 판단합니다.
- 무료 설치 앱은 보통 7일마다 서명 갱신이 필요하며 앱 개수·App ID 등의 제한이 있습니다. 실제 iPadOS 27 호환성은 검증 대상입니다. [AltStore 안내](https://faq.altstore.io/altstore-classic/your-altstore)
- 공개 저장소의 표준 GitHub 실행 환경은 무료입니다. 비공개 저장소는 사용량 한도, 결과물 저장은 별도 한도를 확인해야 합니다. 이 절차는 고급 유료 러너를 사용하지 않습니다. [GitHub 요금](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- GitHub 빌드 환경은 앱을 만드는 컴퓨터입니다. 통화 서버로 사용하는 것이 아닙니다. 이번 단계는 Supabase·TURN·TestFlight·유료 개발자 가입이 필요하지 않습니다.

## 3A 추가 기능

- iOS Broadcast Upload Extension이 WebRTC 153 XCFramework를 사용합니다.
- ReplayKit의 화면 `CMSampleBuffer`를 WebRTC 영상 프레임으로 변환합니다.
- Supabase REST API로 기존 `solaris_signals` 테이블의 offer/answer/ICE를 교환합니다.
- Windows의 `solaris-p2p.html`은 원격 영상 트랙을 표시합니다.
- 음성, TURN, 자동 친구 초대는 아직 포함하지 않습니다.

자세한 시험 순서는 `docs/STEP3_WEBRTC_SCREEN_KO.md`를 확인하세요.

## 다음 단계

`docs/DEVICE_TEST_KO.md`를 채워 실제 결과를 전달해 주세요. 실패하면 1단계 원인부터 수정합니다.
통과 후에만 2인 WebRTC 음성통화, 이후 양방향 화면공유·1080p60 측정으로 진행합니다.
여기서 캡처 FPS가 60으로 보이더라도 실제 1080p60 전송을 확인한 것이 아닙니다.
