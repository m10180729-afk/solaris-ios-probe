# Solaris build56 실행 안내

통합 화면공유·원본 파일 전송 개발 테스트판입니다. 이번 실제 생성 설치 앱은 Android APK입니다. Windows EXE 및 iOS/iPadOS IPA는 CI 빌드가 남았습니다. 전체 재빌드 소스와 다음 작업 메모는 소스 ZIP에 포함합니다.

## Supabase 설정

1. 아직 build55 계정/친구 SQL을 적용하지 않았다면 `backend/001_solaris.sql`을 SQL Editor에서 실행합니다. 기존 build54 테이블을 삭제하지 않습니다.
2. 이미 build55 SQL을 적용했다면 **`backend/002_build56_broadcast_ready.sql`만 적용**합니다. UID/프로필/친구/서버를 보존하고 방송 ready/RPC를 갱신합니다. 전체 초기 스키마를 다시 실행하지 마세요.
3. 익명 로그인을 활성화하고 SQL이 만드는 비공개 `solaris-avatars`를 프로필 사진에 사용합니다. 대용량 파일은 Storage에 업로드하지 않습니다.
4. 복구를 쓰려면 이메일 템플릿에 `{{ .Token }}`을 넣고 실제 코드 인증을 확인합니다. ID는 로그인 비밀이 아닙니다. 복구를 연결하기 전에 앱을 삭제하면 익명 계정을 잃을 수 있습니다.
5. 다른 프로젝트를 쓰면 `shared/config.mjs`의 공개 URL/publishable key를 바꾸고 `python3 scripts/prepare_unified.py` 후 재빌드합니다. service-role key를 앱에 넣지 않습니다.
6. NAT 직접 연결이 실패하면 소유한 TURN 서버를 설정합니다. 중계/오프라인 보관은 무료 P2P와 별도 비용입니다.

운영 SQL/인증 설정은 이번 작업에서 적용하지 않았습니다.

## 설치 및 사용

- **Android:** `Solaris-Android-build56-debug.apk`. 단일 앱에서 계정/프로필/친구/화면공유/파일/서버를 사용합니다. 공유 시작 때 시스템 캡처 승인이 필요합니다. 친구와 개인 공유 요청을 수락하면 직접 연결합니다. 마이크·음성통화는 없습니다.
- **Windows:** Actions가 `Solaris-Windows-build56-Setup.exe` 생성을 구성합니다. 현재 미생성·실행 미검증입니다.
- **iOS/iPadOS:** Actions가 `Solaris-0.4.0-build56-resign.ipa` 생성을 구성합니다. 현재 미생성·Swift 미컴파일입니다. AltStore 재서명에서 앱·방송 확장의 같은 App Group이 필요합니다.

파일 수신 동의 후 저장 위치를 고르고 원본을 전송합니다. 모바일 파일은 OS 정지 시 일시정지하고 다시 앱을 열면 권한·부분 상태를 확인해 복구합니다. 접근 권한이 사라진 송신 원본은 **원본 다시 선택**으로 지정합니다. 크기/해시가 다르면 이어받기를 거부합니다. 무결성 오류는 취소 후 다시 전송합니다. 위험한 파일은 자동 실행하지 않습니다.

APK는 debug 서명이며 실제 기기 설치/캡처 성공을 아직 검증하지 않았습니다. 다른 서명은 덮어설치되지 않을 수 있어 정식 배포 전에 안정된 소유자 서명키를 고정해야 합니다. 계정 복구 없이 앱을 삭제하지 마세요.

## 개발 및 저장

```sh
npm ci
python3 scripts/prepare_unified.py
npm test
npm run test:database
node scripts/unified_ui_test.mjs
node scripts/file_stream_test.mjs
node scripts/unified_browser_test.mjs
node scripts/unified_browser_test.mjs --large
python3 scripts/package_source.py
```

실제 WebRTC는 정상 인터페이스/ICE가 필요한 별도 검사입니다. `file_stream_test.mjs`는 1GiB 디스크·청크 시험이고 실제 P2P가 아닙니다. 플랫폼 빌드는 `.github/workflows/build-ios-probe.yml`을 사용합니다. GitHub 쓰기 403으로 원격 CI는 미실행입니다. 정식 릴리스는 사용자 검증/승인 후 게시합니다.

실제 결과는 `BUILD56_STATUS_KO.md`, 다음 작업은 `CONTINUE_BUILD56_KO.md`, 전체 지시서는 `SOLARIS_SPEC_KO.md`를 읽습니다. 작업을 마칠 때 최신 ZIP과 인계 문서를 함께 전달합니다.
