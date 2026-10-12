# Solaris build61 후속 작업 인계

현재 기준 소스는 `Solaris-0.4.0-build61-source.zip`이다. 빌드60을 기준으로 Google OAuth PKCE, 기존 UID 계정 연결, 이메일 인증·복구 흐름, 프로필 소개, 중복 방송 방지, PC·모바일 UI를 추가했다. 원격 GitHub나 운영 Supabase DB에 자동 반영하지 않았다.

Android 화면공유를 별도 채팅에서 개발한다면 빌드61 ZIP을 기준으로 작업한다. 이미 빌드60에서 Android 캡처를 수정했다면 변경분을 비교해서 병합한다. 오래된 프로젝트 전체로 덮어쓰지 않는다.

반드시 보존할 파일:

- `shared/authflow.mjs`, `api.mjs`, `app.mjs`, `app.css`, `index.html`, `icons.mjs`
- `shared/media.mjs`: 중복 시작·취소 epoch, 이전 native stop 대기, 오래된 heartbeat/status 응답 격리
- `backend/003_build60_dm.sql`, `004_build61_accounts_broadcast.sql`: 영구 DM과 UID당 방송 하나, 프로필 소개
- Android `SolarisActivity.java`, `AuthUrls.java`, `DiskBridge.java`, Manifest: OAuth 앱 복귀·보호 저장·모바일 탐색
- iOS `AuthReturnRouter.swift`, `UnifiedView.swift`, Info.plist: 시스템 인증 및 앱 복귀
- Windows `AuthBrowser.cs`, `AppBridge.cs`, `MainForm.cs`: PKCE 브라우저 복귀

공통 화면 원본은 `shared`다. Android assets와 iOS Unified 리소스를 직접 고치지 말고 `python3 scripts/prepare_unified.py`로 생성한다. Windows도 이 shared 파일을 포함한다. 버전과 Actions 산출물 이름은 build61이다.

화면공유 핵심은 원본 build54 정책을 유지한다. `python3 scripts/check_build54_engine.py`, `python3 scripts/check_build54_capture.py`로 보호 범위를 확인한다. Android `ScreenEngine.java`, `ProjectionService.java`, `BroadcastSignals.java`는 이번 변경에서 보존했다. 화질 선택을 다시 넣거나 FPS를 임의로 낮추지 않는다. 실제 Android SIGSEGV·검은 화면·터치와 13fps 문제는 기기 로그를 확보해 별도로 확인한다.

음성통화·마이크 기능을 추가하지 않는다. 1GB 파일 기능은 제거된 상태이며 일반 파일 상한은 100MiB다. 큰 파일 기능을 다시 활성화하지 않는다. DM은 화면공유 세션 없이도 친구끼리 유지된다.

이번 Google UI 통합 시험은 모사한 제공자를 사용했다. 실제 Google 계정·인증 메일 도착·실기기 캡처·iOS Swift 전체 빌드는 미검증이다. 자세한 결과는 `BUILD61_STATUS_KO.md`를 확인한다.

검증: `npm ci` → `npm test` → `npm run test:database` → `node scripts/unified_ui_test.mjs`; Python 회귀 검사와 플랫폼 빌드도 진행한다. 실제 장치 결과와 자동 테스트 결과를 구분한다. 수정 파일, 소스 ZIP, 업로더와 적용 안내를 함께 저장해 전달한다.

계정·친구·서버 테이블을 삭제하거나 RLS를 해제하지 않는다. GitHub main과 배포 서명 키·DB 최고 권한은 프로젝트 소유자에게 있다. main 강제 push, 승인 없는 공식 릴리스는 하지 않는다.
