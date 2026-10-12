# Solaris 0.4.0 build61 적용 안내

Google 로그인과 기존 계정 연결, 프로필 소개, 중복 방송 방지, PC·모바일 UI 개선을 포함한 테스트 빌드다. 화면공유 품질과 Android 실기기 캡처 문제는 별도의 기기 시험이 필요하다. 이번 버전을 설치했다고 13fps 문제가 해결됐다고 판단하지 않는다.

## 1. 기존 Supabase DB 업데이트

이미 Solaris를 사용하던 프로젝트라면 제공한 **Solaris-build61-DB-update.sql**을 Supabase → SQL Editor에 붙여 넣고 실행한다. 이 파일은 `003_build60_dm.sql` 다음 `004_build61_accounts_broadcast.sql` 순서다. 빌드60 업데이트를 했어도 그대로 재적용할 수 있도록 검증했다.

계정·고유 ID·친구·서버·DM을 유지한다. 기존 중복 방송은 사용자당 하나만 남기고, 삭제된 방송의 시청자 예약도 정리한다. 이후 같은 UID가 다시 방송을 시작하면 이전 방송을 대체한다. 서로 다른 기기에서 **같은 계정으로 동시에 방송하면 마지막 방송 하나만 유지**된다.

기존 DB의 테이블을 삭제하거나 `001_solaris.sql`을 재실행하지 않는다. 첫 설치인 빈 프로젝트만 `001_solaris.sql` → `003_build60_dm.sql` → `004_build61_accounts_broadcast.sql` 순서로 설정한다. RPC가 보이지 않으면 SQL 오류가 없는지 확인하고 `notify pgrst, 'reload schema';`로 캐시를 갱신한다.

SQL 업데이트는 이 작업에서 운영 DB에 자동 적용하지 않았다. 사용자가 적용해야 한다.

## 2. Google 로그인 설정

확인한 공개 인증 설정에서는 Google이 **꺼져 있었다**. 이메일과 익명 인증은 켜져 있었다. Google을 사용하려면 아래 설정이 필요하다.

1. Google Cloud → Google Auth Platform에서 Solaris 앱의 이름·지원 이메일·사용자 범위를 설정한다. 테스트 모드라면 로그인할 Google 계정을 테스트 사용자로 등록한다.
2. OAuth Client를 **Web application** 유형으로 만든다. 이 앱은 Supabase를 거쳐 시스템 브라우저로 Google 인증을 진행한다.
3. Google의 **Authorized redirect URIs**에 다음 주소를 등록한다.

   ```text
   https://lfwjkaipghctigswxoxq.supabase.co/auth/v1/callback
   ```

4. Supabase 프로젝트 `lfwjkaipghctigswxoxq` → Authentication → Sign In / Providers → Google에서 Enable을 켠다. Google의 Client ID와 Client Secret을 입력하고 저장한다. Secret은 앱 코드나 GitHub에 넣지 않는다.
5. Supabase Authentication → URL Configuration → Redirect URLs에 아래 두 패턴을 추가한다. 요청별 상태 값이 주소 뒤에 붙으므로 끝의 `**`를 포함한다.

   ```text
   solaris://auth/callback**
   http://127.0.0.1:43854/auth/callback**
   ```

6. 기존 익명 계정에 Google을 연결하려면 Authentication의 **Manual Linking**도 활성화한다.
7. 앱을 다시 실행한 뒤 처음 화면의 **Google로 계속하기** 또는 **내 프로필 → 내 계정 → Google 계정 연결**을 사용한다.

기존 ID·친구·서버를 유지하려면 현재 계정에 로그인된 상태에서 **Google 계정 연결**을 먼저 사용한다. 연결 전 앱을 삭제하거나 새 Google 계정으로 별도 가입하면 기존 익명 계정의 데이터를 자동으로 가져올 수 없다. UID가 바뀌는 연결 응답은 앱에서 거절한다.

Windows는 시스템 브라우저와 127.0.0.1의 고정 반환 포트를 사용한다. 다른 Solaris 창이 같은 포트를 쓰면 그 창을 닫고 다시 시도한다. Android는 브라우저 인증 후 Solaris 링크로 돌아온다. iOS·iPadOS는 시스템 인증 창을 사용하며 최신 IPA로 다시 빌드해야 한다. 오래된 빌드60 APK·IPA에는 새 반환 처리가 없다.

## 3. 이메일 가입·인증 코드·복구 메일

이메일 비밀번호 로그인, 가입 확인, 이메일 코드 로그인, 비밀번호 복구, 기존 익명 계정에 이메일 연결을 구현했다. 자동 테스트는 요청·코드 검증·같은 UID 유지·복구 후 새 비밀번호 입력을 확인하는 범위다. **실제 받은 편지함의 메일 도착은 확인하지 않았다.** 공개 설정에서는 SMTP 서버·발송 로그가 보이지 않으므로 발송 성공을 보장할 수 없다.

Supabase 기본 SMTP는 프로젝트 팀 이메일에만 보내며, 확인한 공식 문서 기준 시간당 2회 제한과 전달 보장 부재가 있다. 일반 친구가 가입·복구 메일을 받으려면 **Custom SMTP**를 설정해야 한다. 발송 서비스의 Host·Port·Username·Password·From 주소와 도메인 인증을 Supabase Authentication의 SMTP 설정에 넣는다. 무료 한도나 도메인 비용은 제공자에 따라 달라진다.

코드와 링크를 함께 표시하려면 Authentication → Email Templates에 소스의 HTML을 적용한다.

| Supabase 템플릿 | 소스 파일 |
| --- | --- |
| Confirm signup | backend/email-templates/confirm_signup.html |
| Magic link | backend/email-templates/magic_link.html |
| Reset password | backend/email-templates/recovery.html |
| Change email address | backend/email-templates/email_change.html |

새 빌드61에서 메일을 요청하고 **같은 기기의 Solaris로 링크를 열거나 메일의 코드를 입력**한다. 이전 빌드에서 받은 링크는 새 PKCE 요청과 맞지 않을 수 있으므로 새로 요청한다. 재전송은 1분 이상 기다린다. 기본 메일 템플릿에 코드가 없다면 위 템플릿처럼 `{{ .Token }}`을 추가해야 한다.

실제 확인 순서: 사용할 이메일로 가입 → 받은 편지함·스팸함 확인 → 코드 또는 링크 인증 → 앱 재실행 → 비밀번호 로그인 → 비밀번호 복구 요청 → 새 비밀번호 저장 → 다시 로그인. 실패하면 Supabase Auth 로그와 SMTP 제공자의 발송·반송 로그를 함께 확인한다. 오류 없이 요청이 접수됐다는 사실만으로 메일이 도착했다고 판단하지 않는다.

## 4. Git Bash 업로드와 Actions

소스 ZIP을 **새 폴더에 전부 압축 해제**한다. `shared`, `ios`, `android`, `backend`, `UPLOAD_GIT_BASH.sh`가 함께 있는 폴더에서 Git Bash를 열고 실행한다.

```bash
bash UPLOAD_GIT_BASH.sh
```

별도로 받은 업로더를 다른 위치에서 사용할 때는 소스 폴더를 인수로 준다.

```bash
bash UPLOAD_GIT_BASH-build61.sh "/c/Users/사용자/Downloads/Solaris-build61"
```

GitHub 인증을 묻는 화면이 나오면 저장소 소유자의 계정으로 진행한다. 업로더는 기존 build58 이력과 main 기준을 확인한 뒤 `codex/solaris-build61-…` 검토 브랜치를 만든다. main 강제 덮어쓰기·자동 공식 릴리스는 하지 않는다. 공식 병합·서명·업데이트 승인 권한은 소유자에게 있다.

저장소 → Actions → 해당 build61 실행을 열고, 완료된 실행의 Artifacts에서 플랫폼별 결과를 받는다.

| 플랫폼 | 결과 |
| --- | --- |
| Windows | Solaris-Windows-build61 / 설치 EXE와 통합 앱 |
| Android | Solaris-Android-build61-debug / 단일 디버그 APK |
| iOS·iPadOS | Solaris-0.4.0-build61-integrated / AltStore 재서명용 IPA 후보 |

Actions의 미디어 통합 검사가 실패하면 iOS 결과가 생성되지 않을 수 있다. 실패를 건너뛰지 말고 해당 실행 로그를 확인한다. IPA는 Apple 서명·AltStore 설치가 별도로 필요하다.

제공한 Android APK는 개발용 디버그 서명이다. 이전 APK와 서명이 다르면 덮어쓰기 설치가 거절될 수 있다. 이때 익명 계정을 복구할 수 있도록 이메일·Google 연결을 먼저 완료한다. 앞으로는 소유자가 관리하는 동일한 서명 키로 빌드를 유지해야 한다.

## 5. 모바일 사용과 다음 개발

휴대폰은 하단 탐색, 서버·DM 메뉴 서랍, 가득 찬 대화 화면을 사용한다. Enter는 줄바꿈이고 보내기 버튼으로 전송한다. PC는 Enter 전송·Shift+Enter 줄바꿈이다. Ctrl/Command+Enter로도 전송할 수 있다. 프로필 편집은 하단 내 프로필에서 열 수 있다.

화질 선택 메뉴는 없고 고화질·60fps 요청을 유지한다. 원본 빌드54 Windows 엔진과 ReplayKit 프레임 처리는 해시 검사를 통과했다. 이 사실은 실제 기기에서 원하는 FPS를 달성했다는 뜻이 아니다.

Android 캡처 작업을 새 채팅에서 이어 갈 때는 **이번 빌드61 소스**와 `docs/CONTINUE_BUILD61_KO.md`를 전달한다. 빌드60 전체 파일로 되돌리면 계정과 UI 변경을 잃을 수 있다.

## 공식 설정 문서

- Google: https://supabase.com/docs/guides/auth/social-login/auth-google
- 계정 연결: https://supabase.com/docs/guides/auth/auth-identity-linking
- 앱 복귀: https://supabase.com/docs/guides/auth/native-mobile-deep-linking
- SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- 이메일 템플릿: https://supabase.com/docs/guides/auth/auth-email-templates
