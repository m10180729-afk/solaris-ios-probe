# build63 · Google 계정 연결 복귀 수정

기준은 build62 `ca4c193442410101d6894601c1bc659a65c909b5`다. iPad에서 설정의 Google 계정 연결 후 앱으로 자동 복귀하지만 대기 문구가 남는 문제가 보고되었다. 다른 기기에서도 같은 대기 문제를 막도록 Windows·Android·iOS의 반환 처리를 함께 보완한다.

서버의 민감정보를 제거한 오류 기록에 이미 연결된 identity가 현재 계정 또는 다른 계정에 다시 연결되어 거절된 경우가 있었다. 기존 모바일 복귀 주소와 쿼리는 공개 인증 요청에서 보존됨을 확인했고, 서버에서 S256 PKCE flow가 생성됨도 읽기 전용 집계로 확인했다. 실제 사용자 인증을 대신 수행하거나 연결된 계정을 강제로 옮기지는 않았다.

- OAuth 오류 fragment를 네이티브에서 조용히 폐기하던 문제: 인증 응답의 정확한 주소·단일 query state를 검사하고 원문 fragment·토큰·설명은 버린다. 허용된 고정 오류만 기존 JS state 검증으로 전달한다. 암시적 토큰 응답은 세션으로 수용하지 않는다.
- Windows는 HTTP에 전달되지 않는 fragment를 고정 스크립트와 제한된 CSP로 안전한 오류 쿼리로 바꾼다. 잘못된 state/경로/중복/메서드는 계속 거절하고 비밀을 페이지에 반영하지 않는다.
- 반환 mailbox는 읽기만으로 지우지 않는다. JS에서 처리한 반환과 정확히 일치하는 ACK로만 제거하고 기기 복귀 시 미처리 반환을 다시 확인한다.
- 앱 초기화를 두 번 실행해 진행 중인 PKCE 교환을 취소하던 경쟁을 오프라인에서 재현하고 수정한다. 기존 state/UID/revision 보호를 유지한다.
- 실패 시 대기 문구를 종료하고 오류와 재시작 방법을 표시한다. 현재 서버 계정의 Google 연결이 이미 확인된 경우 재연결 버튼을 비활성화한다.
- 검증된 실패 반환의 요청만 저장소에서 종료해 앱 재시작 시 실패한 인증 대기가 다시 살아나지 않도록 한다. 다른 state·계정 또는 더 새 요청은 보존하고, 중복 반환은 같은 오류 안내를 유지한다.

“Google 계정 연결”은 현재 Solaris UID에 로그인 수단을 추가하는 동작이다. 이미 다른 Solaris UID에 연결된 Google 계정은 현재 UID에 강제로 붙일 수 없다. 기존 Google 계정으로 로그인하려면 현재 계정의 이메일/다른 Google 등 복구 수단을 먼저 확보하고 로그아웃 후 첫 화면의 Google 로그인을 사용한다. 친구·서버·메시지는 UID별로 유지되며 다른 계정과 자동 합쳐지지 않는다. 앱 삭제·identity unlink·계정 병합·운영 DB 변경은 수행하지 않는다.

JS 실제 시작/콜백/오류 UI 시험, Windows 실제 loopback 시험과 fragment relay 시험, Android JVM sanitizer/mailbox 시험, Foundation Swift sanitizer/mailbox 시험을 추가한다. 최종 플랫폼 컴파일과 APK/IPA/EXE 산출물은 해당 커밋의 CI 통과 결과로 확인한다. 실제 iPad/Android/Windows에서의 Google 인증 완료는 수정 빌드 설치 후 확인해야 하며 자동 시험 성공으로 이를 단정하지 않는다.

build54 미디어 엔진과 build62의 공유·로그아웃·파일 기능은 유지한다. Supabase 기존 redirect allowlist와 PKCE 보안 설정은 유지하며 새 SQL을 적용하지 않는다.
