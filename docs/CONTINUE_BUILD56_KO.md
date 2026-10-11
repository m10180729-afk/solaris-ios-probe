# Solaris 다음 작업 인계 — build56

2026-10-11 최신 소스는 `Solaris-0.4.0-build56-source.zip`입니다.

저장소: https://github.com/m10180729-afk/solaris-ios-probe

GitHub main: build54 `4c50dbe33721b5d10db714bd79da74267a8863b4`. build55 로컬 커밋 `3f3dcc7` 위에서 build56을 구현했습니다. 브랜치는 `codex/solaris-build56-recovery`입니다. 원격 쓰기 API 403으로 GitHub에 build56이 올라갔다고 가정하면 안 됩니다.

## 사용자 요청을 유지할 것

- 기존 코드에서 실제 구현·빌드·검증을 이어갑니다. 계획만 제시하지 않습니다.
- Windows/iOS/iPadOS/Android 단일 앱의 화면공유 송수신·원본 대용량 파일 전송이 목적입니다. 마이크·음성통화는 추가하지 않고 Discord와 함께 사용합니다.
- 전체 방향은 `SOLARIS_SPEC_KO.md`입니다. 계정/프로필/친구를 우선하고 동의·권한·연결 안정성을 유지합니다. 정식 릴리스 권한은 사용자에게 있습니다.
- 승인된 개발 작업은 매번 확인을 다시 요구하지 말고 진행합니다.
- **작업을 멈추거나 마무리하기 전에 최신 전체 소스 ZIP과 진행/남은 작업 메모를 파일로 전달합니다.** 이전 대화 링크 없이도 새 ZIP에서 복구할 수 있게 합니다.

## 시작 및 다음 우선 작업

1. 이 문서와 `BUILD56_STATUS_KO.md`를 읽습니다. build55에서 구현한 계정/친구/서버/파일/네이티브 어댑터를 다시 처음부터 만들지 않습니다. `shared/`가 공통 원본이고 수정 후 `python3 scripts/prepare_unified.py`로 모바일 번들을 재생성합니다. `npm ci`, `npm test`, `npm run test:database`를 실행합니다.
2. 최신 GitHub와 비교하고 검토 브랜치에 올립니다. API는 `403 Resource not accessible by integration`, CLI도 인증이 없었습니다. 사용자 Git Bash에서 ZIP의 `UPLOAD_GIT_BASH.sh`를 실행하는 방법도 있습니다. 스크립트는 main이 build54면 새 브랜치로 올리고, main이 바뀌었으면 중단합니다. 새 작업을 검토해 통합하며 force push/자동 정식 릴리스는 하지 않습니다.
3. Actions 6개 작업을 실제 실행하고 실패 로그를 수정합니다: 브라우저 권한/UI/5명/양방향, native RTP/H264, Windows 설치 EXE, Android APK/JVM, macOS 확장 IPA, 1GiB DataChannel. 현재 환경은 인터페이스 조회 EPERM/ICE 후보 0개여서 실제 연결 시험에 제한이 있습니다. 디스크 청크 시험을 P2P 시험으로 보고하지 않습니다.
4. Windows publish/설치 및 Xcode/IPA를 검증합니다. 새 `ProcessMetrics.swift` 및 macOS 테스트는 아직 컴파일 전입니다. iOS 앱·방송 확장의 같은 App Group이 재서명에서 유지되는지 확인합니다.
5. 운영 Supabase SQL 적용 여부를 먼저 확인합니다. 신규 DB는 `001_solaris.sql`, 기존 build55 DB는 `002_build56_broadcast_ready.sql` upgrade를 사용합니다. 익명 Auth와 실제 이메일 OTP가 동일 UID를 보존하는지 확인합니다. service-role key/서명키는 앱/ZIP에 넣지 않습니다.
6. build56 APK에서 승인·회전·백그라운드 캡처·새 시청자·토큰 만료·재실행을 실제 Android로 검증합니다. Windows 최소화 중 장시간 타이머/lease와 iOS WK/확장 종료도 확인합니다.
7. 상태 문서의 플랫폼 조합에서 양방향/전체화면/늦은 참여/동시 방송/5명/네트워크 전환을 시험합니다. 실제 1GiB 원본 전송·단절/재개·해시, 화면공유+파일 동시 사용, 수동 정지·권한 회수·디스크 부족을 확인합니다.
8. 자동 업데이트/rollback/소유자 서명·설치파일 해시, 정식 인증 UI·재설치 복구, 실제 화질/CPU/발열/부하, 요청 남용 방지·운영 관측을 보강합니다. 핵심 검증 이후 정식 UI를 완성합니다.

## 변경한 핵심 위치

- `shared/api.mjs`: 계정 세대/vault 직렬화 및 UID 불일치 방어
- `shared/files.mjs`, `platform.mjs`: 완료/취소/수동정지 경쟁, disk flush/hash, 원본 재선택/체크포인트
- `shared/lifecycle.mjs`, `diagnostics.mjs`: 생명주기/복귀, 계정별 제한된 비밀 제거 로그
- `shared/media.mjs`, `app.mjs`: native 상태 복구, 계정 전환·채널 권한 및 프로필 갱신
- `android/.../BroadcastSignals.java`, `ScreenEngine.java`, `SolarisActivity.java`: WebView 독립 signaling/토큰/lease, 상태/알림
- `backend/002_build56_broadcast_ready.sql`: 기존 데이터를 보존하는 ready upgrade
- `ios/Shared/ProcessMetrics.swift`, `ios/App/UnifiedView.swift`, `ios/Broadcast/UnifiedBroadcastSender.swift`: 진단·WK/ReplayKit 보강
- `tests/unified_auth.test.mjs`, `unified_recovery.test.mjs`, `BroadcastSignalsTest.java`, `database.test.mjs`: 추가 회귀

139개 자동 시험, C# 엔진 18개, UI/1GiB 디스크/APK는 통과했습니다. 운영 DB/실제 기기/설치 EXE/iOS 컴파일·IPA/실제 네트워크 결과는 별도입니다. 수행한 범위만 보고합니다.
