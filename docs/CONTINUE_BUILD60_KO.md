# Solaris build60 이어서 개발할 때

최신 사용자는 1GB 이상 대용량 파일 전송을 개발 범위에서 제외했다. 일반 파일은 최대 100MiB로 유지한다. 이 지시가 원래 종합 지시문의 대용량 목표보다 우선한다. 음성통화와 마이크 입력은 추가하지 않는다. 채팅은 친구 DM 중심의 단순한 텍스트 기능이다.

## 복구 기준과 보호할 엔진

이번 작업은 영구 저장됐던 `Solaris-build59-checkpoint-source.zip`에서 복구했다. 유실된 마지막 build59 파일을 복구했다고 보고한 것이 아니다. GitHub main의 build54 기준은 `4c50dbe33721b5d10db714bd79da74267a8863b4`이고, 마지막 업로드된 build58 기준은 `a0054ba78a922cd750b14ce70ea6b9b78dd57670`이다. build60 업로더는 이 build58 브랜치 기록을 유지한다.

`docs/BUILD54_ENGINE_MANIFEST.json`의 Windows 엔진 파일 6개와 JavaScript 미디어 함수 6개는 build54와 일치한다. `docs/BUILD54_CAPTURE_REFERENCE.json`은 Windows 캡처 파일과 ReplayKit 캡처 펌프를 보호한다. 화질 최적화를 이유로 원본 H264/RTP 경로를 다시 다른 엔진으로 바꾸지 않는다. 원본과의 소스 일치는 실제 기기에서 60fps가 확인됐다는 뜻이 아니다.

## 변경한 구조

- `shared/media.mjs`: 로컬 종료 먼저, 서버/네이티브 정리 별도 수행, 수신 시도·종료 직렬화, 시작 실패·뒤늦은 응답 정리, 자동 복구 2회 후 명시적 다시 시청, 진단 tick 중첩 방지. 정상 연결의 정지 화면은 연결 실패로 판단하지 않는다.
- `shared/viewing.mjs`: 영상 영역 마스크 계산과 전체화면 해제. 영상 수신 종료 시 확대·전체화면·네이티브 덮개를 즉시 해제한다.
- `shared/app.mjs`: DM을 화면공유 세션과 독립적으로 표시, 날짜·프로필·시간·묶음 메시지·실패 재전송·읽지 않은 개수·대화별 입력 초안. 인증 및 디버그 안내는 개인 대화 목록에 섞지 않는다. 메시지 DOM과 로컬 저장을 불필요하게 다시 만들지 않는다.
- `shared/chat.mjs`: UID별 대화 저장, 서버 메시지 중복 제거, client_id로 멱등 재전송, 계정 변경 후 오래된 응답 격리. 최신 로컬 캐시와 이전 대화 표시 창은 각각 200개로 제한한다. 전체 대화는 서버에 저장한다.
- `backend/003_build60_dm.sql`: 영구 DM 테이블, 친구 관계/차단 검증, dm_send/dm_history, sync 메시지 제공, 파일 제한. 기존 RPC를 private 내부 함수로 옮기며 외부에서 직접 우회 호출할 수 없다. definer 함수의 임시 스키마 우선순위도 고정한다. 기존 데이터를 보존하는 재실행 가능한 업데이트다.
- `shared/files.mjs`와 3개 네이티브 파일 브리지: 100MiB 제한. 큰 파일은 해시를 계산하기 전에 거절한다. 예전 큰 파일 전송 기록은 재개하지 않는다. 일반 파일의 청크·무결성·일시정지 처리는 유지한다.
- `android/.../SolarisActivity.java`: 영상 custom view와 WebView 복원 경로 통합, 재진입 안전한 callback 처리, 시스템 바/insets 복구, 캡처 허가 대기 취소 응답, 실패 시 전체화면 종료.
- `ios/App/UnifiedView.swift`: 닫는 수신기의 전체화면 해제, 이전 connectionID의 종료 무시, 네이티브 영상 마스크, 방송 취소 시 ReplayKit 선택 시트 닫기.

`shared`가 공통 UI 원본이다. 모바일 복사본을 직접 고치지 말고 `python3 scripts/prepare_unified.py`로 갱신한다. iOS 단일 HTML 번들은 CDN이나 unsafe file access 없이 해시 CSP를 사용한다.

## 확인된 범위와 다음 검증

자동 결과는 `BUILD60_STATUS_KO.md`와 검증 ZIP에 있다. 실제 Windows/Android/iPad/iPhone 조합에서 화면 캡처, FPS, 네트워크 전환, 전체화면 중 실패, 터치 복구, 네이티브 재접속을 아직 확인하지 않았다. 여기서 실제 ICE 네트워크 인터페이스 조회가 차단돼 실전 P2P 테스트를 통과했다고 말할 수 없다. Xcode와 기기가 없는 환경이므로 Swift/iOS 컴파일도 확인하지 않았다.

우선 새 GitHub Actions의 Windows installer/Android APK/iOS IPA 빌드 결과를 확인한다. 이후 동일 build60으로 Windows↔Android, Windows↔iPadOS의 실제 1080p60 화질과 실패 복구부터 확인한다. 실제 문제가 있으면 원본 캡처 엔진을 바꾸기 전에 진단의 frames/fps/codec, ICE state, 원격 connectionID와 송수신 시간을 비교한다. iOS 네이티브 수신기는 RTT/손실률을 측정하지 못하면 파란색 품질로 표시하지 않는다.

DM은 소규모 텍스트 저장 기능이다. 첨부 파일 영구 저장, 음성통화, Discord 전체 채팅 기능, 1GB 전송으로 범위를 다시 넓히지 않는다. P2P/NAT 실패와 TURN 중계 비용은 별도 운영 문제이며 모든 네트워크에서 무료 연결을 보장하지 않는다.

각 작업을 끝내거나 중간에 멈출 때 소스 ZIP과 실제 적용 방법을 함께 전달한다. 다음 상태를 문서에 남기며 실기기 검사와 자동 검사를 구별한다. 프로젝트 소유자의 main/릴리스/서명 권한을 임의로 변경하지 않는다.
