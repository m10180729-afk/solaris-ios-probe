# Solaris build58 사용 및 빌드

빌드54 캡처 복원, 이메일·비밀번호 로그인, Android 캡처 수명 관리, 서버·채널·개인 대화 화면을 수정한 테스트 버전입니다. 실기기의 60fps 회복이나 Android 튕김 해결은 아직 확인하지 않았습니다.

## 파일과 Git Bash 업로드

1. `Solaris-0.4.0-build58-source.zip`을 새 폴더에 **전부** 압축 해제하세요.
2. `shared`, `android`, `ios`, `backend`, `UPLOAD_GIT_BASH.sh`가 함께 있는 폴더에서 Git Bash를 열어 실행하세요.

```bash
bash UPLOAD_GIT_BASH.sh
```

다른 폴더에서 실행할 때는 다운로드한 스크립트와 압축 해제한 소스 경로를 함께 지정할 수 있습니다.

```bash
bash "/c/Users/내이름/Downloads/UPLOAD_GIT_BASH.sh" "/c/Users/내이름/Downloads/Solaris-source"
```

스크립트는 소스 버전과 Git 기록을 검사하고, 빌드57 브랜치에서 별도 빌드58 테스트 브랜치를 만들어 업로드합니다. main의 빌드54와 기존 브랜치를 덮어쓰지 않습니다. 기준 기록이 바뀌었다는 메시지가 나오면 검사를 제거하지 말고 새 기록과 소스를 통합해야 합니다.

[GitHub Actions](https://github.com/m10180729-afk/solaris-ios-probe/actions)에서 업로드한 브랜치의 검사가 끝나면 다음 아티팩트를 받으세요.

| 플랫폼 | 아티팩트 | 설치 파일 |
| --- | --- | --- |
| Windows | Solaris-Windows-build58 | Solaris-Windows-build58-Setup.exe |
| Android | Solaris-Android-build58-debug | Solaris-Android-build58-debug.apk |
| iOS / iPadOS | Solaris-0.4.0-build58-integrated | Solaris-0.4.0-build58-resign.ipa |

Windows 설치 파일과 IPA는 이번 작업 환경에서 생성하지 않았습니다. 새 빌드58 Actions가 실제로 성공해야 받을 수 있습니다. IPA는 AltStore 등에서 재서명하는 후보이며 설치·방송은 별도 기기 검증이 필요합니다.

## 계정과 로그인

기존 ID 계정이 열리는 기기에서 **내 프로필 → 이메일 인증 → 비밀번호 저장** 순으로 연결하세요. 같은 UID의 친구·서버 정보를 유지한 채 이메일·비밀번호 로그인을 사용할 수 있습니다. 이메일을 연결하지 않은 기기 계정에는 로그아웃 버튼을 제공하지 않습니다.

새 사용자는 시작 화면의 계정 만들기에서 ID, 닉네임, 이메일, 비밀번호를 입력할 수 있습니다. 이 경로에는 익명 인증이 필요하지 않습니다. `ID로 빠르게 시작`을 사용하려면 Supabase 익명 인증을 활성화해야 합니다.

Supabase에서 Email 인증과 가입을 허용하고, 기존 익명 계정에 이메일을 연결할 경우 수동 계정 연결을 활성화하세요. 익명 계정은 이메일 인증이 끝난 뒤 비밀번호를 설정해야 합니다.

앱의 코드 입력 방식이 작동하도록 Supabase의 **Confirm sign up, Magic link / OTP, Change email address, Reset password** 이메일 템플릿 본문에 다음 코드를 넣으세요.

```html
<h2>Solaris 인증 코드</h2>
<p>Solaris에서 아래 인증 코드를 입력하세요.</p>
<p>{{ .Token }}</p>
```

서버의 실제 이메일 발송과 로그인은 프로젝트 설정에 따릅니다. 자동 테스트는 인증 응답을 대체했으며 실제 이메일을 발송하지 않았습니다. 공식 안내: [익명 계정 전환](https://supabase.com/docs/guides/auth/auth-anonymous), [비밀번호 인증](https://supabase.com/docs/guides/auth/passwords), [이메일 템플릿](https://supabase.com/docs/guides/auth/auth-email-templates).

새 Supabase 프로젝트에는 `backend/001_solaris.sql`을 실행하세요. 정상 사용 중인 빌드56/57 데이터베이스에는 빌드58을 위한 새 마이그레이션이 없습니다. 사용자 테이블을 삭제하거나 RLS를 끄지 마세요.

APK의 서명 키가 설치된 앱과 다르면 덮어쓰기 설치가 거부될 수 있습니다. 이 경우 기존 앱이 열릴 때 먼저 이메일 인증과 비밀번호를 연결해 계정 복구를 마련하세요. 이 체크포인트에는 운영용 서명 키가 포함되어 있지 않습니다.

## 실제 기기 확인

두 기기에서 서로 다른 계정으로 로그인하고 친구 요청을 수락하세요. 개인 메시지에서 화면공유 요청을 수락한 뒤 각각 화면공유를 시작하세요. 채널에서는 같은 서버의 채널에 참여해 방송을 선택하면 됩니다. iOS / iPadOS는 시스템 방송 선택창에서 Solaris 방송을 시작해야 합니다.

움직이는 동영상이나 게임 화면에서 **설정 → 진단 내보내기**를 확인하세요. 정지 화면은 캡처 콜백이나 FPS가 줄어들 수 있으므로 성능 판단에 쓰지 마세요. 화면공유 영상의 품질 표시는 수신 해상도와 실제 디코딩 FPS를 사용합니다.

| 확인 구간 | 진단 |
| --- | --- |
| Windows 캡처·인코딩 | nativeEncodedFPS, encoderImplementation |
| iOS / iPadOS 캡처 | callbackFPS, submittedFPS, senderQueueDrops |
| iOS / iPadOS 인코딩 | encoders.statistics.encodedFPS, encoderImplementation |
| Android 캡처 | captureFPS, framesSubmitted |
| Android 인코딩 | peers.encoder.encodedFPS, qualityLimitationReason |
| 영상 수신 | fps, codec, decoder, decodeMilliseconds, framesDropped |

Android가 다시 튕기면 앱의 진단과 함께, USB 디버깅과 adb가 준비된 PC에서 `scripts/COLLECT_ANDROID_LOGS_GIT_BASH.sh`를 실행해 충돌 구간을 확인할 수 있습니다. 생성한 로그에 계정 토큰이 포함되어 있지 않은지 확인한 뒤 문제 분석에 사용하세요.

같은 Wi-Fi뿐 아니라 서로 다른 Wi-Fi·모바일 데이터, 양방향 방송, 늦은 참가, 재시작을 확인해야 합니다. 직접 연결이 안 되는 환경에는 TURN이 필요할 수 있고 중계 비용이 발생할 수 있습니다.
