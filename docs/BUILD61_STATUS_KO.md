# Solaris build61 구현·검증 결과

## 구현

- 시스템 브라우저 Google 로그인과 기존 UID 계정 연결. PKCE S256·요청 상태·만료·반환 주소 검증, 보호된 verifier 저장, 서버 사용자 확인을 적용했다. 연결 중 UID가 바뀌는 응답은 저장하지 않는다.
- 이메일 가입·비밀번호 로그인·OTP·비밀번호 복구·기존 계정 이메일 연결을 앱 복귀 흐름에 통합했다. 가입 인증 재전송은 원래 verifier를 유지하며 메일 템플릿에 코드와 링크를 제공한다.
- 프로필 소개 190자, Unicode 길이 검사·미리보기·친구/서버/DM 프로필 반영. 고유 ID와 닉네임은 분리한다.
- 서버의 UID당 방송 하나 제한, 멱등 시작 재시도, 오래된 종료·heartbeat 격리. 권한 검증 전에 기존 방송을 삭제하지 않는다.
- 앱 중복 시작·시작 취소·늦은 상태 응답 처리, 이전 native stop과 새 엔진 시작 직렬화. 친구 DM 탐색만으로 다른 친구에게 진행 중인 개인 방송을 종료하지 않는다.
- PC 서버 레일·채널/DM 목록·프로필 패널, 휴대폰 전체 대화 화면·하단 메뉴·메뉴 서랍·키보드 대응. 터치 Enter는 줄바꿈, 보내기 버튼으로 전송한다.
- 친구 추가와 목록 검색 분리, 갱신 중 입력·IME 노드 유지, 프로필 모달에서 대화 이동 시 닫기. TURN 인증 유지·삭제·손상 데이터 대응과 설정 항목 이름을 보완했다.
- 버전·Actions·업로더 결과를 build61로 맞췄다. 원격 업로드·운영 DB 변경·공식 릴리스는 하지 않았다.

## 이번 실행의 검증

| 검사 | 결과 | 실제 범위 |
| --- | --- | --- |
| 공통 JavaScript | 96개 통과 | 인증·PKCE·UID·미디어 경쟁 상태·파일·DM 회귀 |
| DB·권한 | 18개 통과 | PGlite 실제 SQL 실행, 프로필·중복 방송·재시도·RLS·기존 데이터 유지 |
| Python·Git Bash | 49개 통과 | 업로더 로컬 Git 시나리오, 버전·소스·iOS 묶음 구조 |
| 기존 방송 JavaScript | 33개 통과 | build54 캡처·협상 정책 회귀 |
| Chromium UI | 통과 | 공통 모듈과 iOS HTML 번들, 두 계정·친구·서버·DM·재실행·프로필·반응형 |
| Google UI 통합 | 통과, 제공자 모사 | 실제 PKCE/앱 복귀 코드, 가짜 OAuth HTTP 제공자. 실제 Google 로그인 아님 |
| 모바일 터치 UI | 통과, 브라우저 | 별도 touch/coarse-pointer 컨텍스트, Enter·보내기·입력 높이 초기화·190자 소개·서랍 |
| 화면공유 실패 후 입력 복구 | 통과, native bridge 모사 | 실제 Media/UI와 지연된 가짜 native 종료, 전체화면 제거·버튼·입력 확인 |
| Android JVM | 15개 통과 | 기존 13개 + OAuth URL·반환 주소 검사 2개 |
| Android APK | 생성 성공 | 디버그 APK, 모든 포함 shared 파일과 최종 원본 바이트 일치 |
| Windows MSBuild | 컴파일 성공 | 0 errors, 기존 경고 2개. 설치 EXE 생성·설치 시험 아님 |
| Windows 인증 반환 | 8개 통과 | 실제 loopback TCP, nonce·주소·HTTP 메서드·중복 반환·취소 |
| C# 전송 단위 검사 | 21개 통과 | 기존 스케줄링·RTP/NAL·버퍼 검사. 실제 네트워크 미디어 아님 |
| build54 보존 | 해시 검사 통과 | Windows 엔진 6개·공통 정책 6개·Windows 캡처·ReplayKit 프레임 처리 |
| Actions 구성 | YAML 파싱 성공 | build61 산출물과 인증 검사 단계 |

검증 ZIP에는 로그·JSON·Android JVM XML을 포함한다. UI 스크린샷은 배포 파일에 넣지 않는다. 자동 테스트가 실기기 시험을 대체하지 않는다.

## 미검증·제한

실제 Google 계정 로그인·새 기기 계정 복구·iOS 인증 창, 실제 가입 확인·코드·복구 메일 도착과 SMTP 로그, iOS Swift 전체 컴파일·Apple 서명·AltStore 설치는 확인하지 않았다.

Windows↔Android↔iOS↔iPadOS 실기기 캡처, Android 실제 MediaProjection·시청 시 종료·네이티브 crash, 실제 FPS·해상도·지연·발열, 네트워크 중단 복구, 화면공유와 파일 전송 동시 성능, Windows 설치 EXE 설치·업데이트 데이터 보존은 미검증이다.

실제 WebRTC 브라우저 시험은 실행 환경의 네트워크 인터페이스 탐색 제한으로 **BLOCKED**였다. 성공으로 세지 않았다. 원본 build54 보존이 실제 고화질/FPS 해결을 의미하지 않는다. **13fps 문제의 해결 여부는 아직 판단할 수 없다.**

공개 Supabase 설정 확인 당시 Google은 false, email·anonymous_users는 true이고 가입 이메일 인증은 필요했다. SMTP·Manual Linking·Redirect allowlist·SQL 배포 상태는 공개 설정만으로 확인할 수 없다. 운영 DB·인증 제공자·SMTP를 변경하지 않았다.

음성통화·마이크는 추가하지 않았다. 1GB 기능은 제거되어 있고 일반 파일 상한은 100MiB다. build54 Windows·ReplayKit 엔진과 Android ScreenEngine·ProjectionService·BroadcastSignals 핵심 파일을 유지했다. 적용법은 START_BUILD61_KO.md, 별도 Android 작업 병합은 CONTINUE_BUILD61_KO.md를 확인한다.
