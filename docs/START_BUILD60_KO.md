# Solaris build60 시작 방법

1. `Solaris-0.4.0-build60-source.zip`을 **새 폴더에 전부** 압축 해제합니다. `shared`, `ios`, `android`, `backend`, `UPLOAD_GIT_BASH.sh`이 보이는 폴더가 소스 루트입니다.
2. 현재 계정과 친구 기능이 작동하는 Supabase 프로젝트의 SQL Editor에서 `backend/003_build60_dm.sql` 전체를 실행합니다. 기존 계정·친구·서버·채널을 삭제하지 않습니다. 이 업데이트 파일은 재실행해도 기존 DM을 보존합니다. 처음 구성하는 새 DB는 `001_solaris.sql` 이후 `003_build60_dm.sql`을 실행합니다. build55 DB만 `002_build56_broadcast_ready.sql`을 먼저 적용합니다. 기존 DB에 `001`을 다시 실행하지 마세요.
3. 소스 루트에서 Git Bash를 열고 아래 명령을 실행합니다.

```bash
bash UPLOAD_GIT_BASH.sh
```

별도 위치에 받은 업로더를 실행하는 경우, **실제 소스 폴더 경로**를 인자로 지정합니다.

```bash
bash "/c/Users/본인/Downloads/UPLOAD_GIT_BASH.sh" "/c/Users/본인/Downloads/Solaris-0.4.0-build60-source"
```

GitHub 로그인이 필요하면 Git for Windows의 안내에 따라 로그인합니다. 스크립트는 검증한 build58 기록 위에 별도 `codex/solaris-build60-...` 브랜치를 만들며 main을 덮어쓰지 않습니다. 기준 기록이 변경됐다고 중단하면 강제 업로드하지 말고 새 작업을 먼저 통합합니다.

[GitHub Actions](https://github.com/m10180729-afk/solaris-ios-probe/actions)에서 새 build60 실행을 확인하고 성공한 아티팩트를 받습니다.

| 플랫폼 | 설치 파일 |
| --- | --- |
| Windows | `Solaris-Windows-build60` 아티팩트의 `Solaris-Windows-build60-Setup.exe` |
| Android | `Solaris-Android-build60-debug.apk` |
| iOS / iPadOS | `Solaris-0.4.0-build60-integrated` 아티팩트의 IPA, 기존 AltStore 재서명 방식 사용 |

이 대화에서 함께 제공한 APK는 로컬에서 빌드한 테스트 파일입니다. Windows 설치 EXE와 iOS IPA는 이 세션에서 생성하지 않았습니다. iOS 빌드 성공·App Group 재서명·실제 설치를 확인해야 합니다. 테스트하는 기기는 모두 build60으로 맞춥니다.

이 APK의 디버그 서명이 기존 설치 파일과 다르면 덮어쓰기 설치가 거절될 수 있습니다. **기존 앱을 삭제하기 전에** 이메일 계정 연결과 로그인 가능 여부를 확인합니다. UID가 유지되는 인증으로 복구해야 기존 친구와 서버를 사용할 수 있습니다. 현재 사용자 데이터가 정상이라면 기존 앱을 먼저 삭제할 필요가 없습니다.

## 이번 버전의 동작

- 친구를 선택하면 화면공유를 연결하지 않아도 DM을 보낼 수 있습니다. 오프라인 상대에게 보낸 텍스트는 DB에 남고 다음 접속 때 조회됩니다.
- Enter로 메시지를 보내고 Shift+Enter로 줄을 바꿉니다. 실패한 메시지는 `다시 보내기`로 재시도합니다. 이전 대화를 보는 중에는 `최근 대화로 이동`으로 돌아옵니다.
- 화면공유는 친구 요청 수락 후 시작합니다. 실패한 시청 화면에는 `다시 시청`이 표시됩니다. 자동 복구가 계속 실패하면 무한히 다시 열지 않습니다.
- 일반 파일 전송은 온라인 상대에게 최대 **100MiB**까지 가능합니다. 1GB 이상 파일 전송은 지원하지 않습니다.

`Unknown action` 또는 DM 관련 서버 오류가 보이면 `003_build60_dm.sql` 적용 여부를 확인합니다. 익명 가입을 비활성화한 프로젝트에서는 이메일 계정 만들기와 기존 이메일 로그인을 사용할 수 있습니다.
