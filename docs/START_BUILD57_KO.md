# Solaris build57 실행 안내

화질/FPS 저하 및 Android 공유 경로/UI를 수정한 개발 테스트판이다. 실제 기기 테스트 결과는 아직 없다. 이전 build56이 정상 계정/서버로 접속됐다면 Supabase SQL이나 Auth 설정을 다시 바꾸지 않는다.

## 파일

- `Solaris-Android-build57-debug.apk`: 이번에 실제 생성한 Android 단일 앱.
- `Solaris-0.4.0-build57-source.zip`: Windows/Android/iOS 전체 소스, 업로더, 전체 개발 지시서와 이어서 작업할 메모.
- `UPLOAD_GIT_BASH.sh`: 별도 다운로드로도 제공하는 Git Bash 업로더. 최신 소스 ZIP에도 같은 파일이 들어 있다.
- `Solaris-build57-verification.zip`: 자동화 검사 로그/결과. 실제 기기 성공 보고가 아니다.

방송 시작에 화질 선택은 없다. 고화질/60fps를 기본 요청하며 실제 지원 범위는 기기와 네트워크에 따른다. Android는 공유 버튼 이후 시스템 캡처 동의를 받아야 한다. 영상 재생 화면의 해상도/FPS 표시는 실제 수신 통계다. 서버 탈퇴는 서버 이름 옆의 서버 메뉴 안에서 빨간 버튼을 누르고 확인한다. 접속 상태는 프로필 옆 작은 점이다. 모바일은 왼쪽 위 메뉴로 채널/프로필을 열 수 있다.

## Windows/iPad도 같은 빌드로 맞추기

소스 ZIP을 새 폴더에 전부 압축 해제한다. `UPLOAD_GIT_BASH.sh`와 `shared`, `ios`, `android`, `windows-native`가 같은 위치에 있어야 한다. Git Bash를 해당 폴더에서 열고 실행한다.

```bash
bash UPLOAD_GIT_BASH.sh
```

다른 위치에 다운로드한 스크립트로 실행할 경우에는 소스 폴더 경로를 인자로 지정한다. 공백/한글이 있는 경로도 큰따옴표로 감싼다. 아래의 사용자 이름과 폴더명은 실제 경로로 바꾼다.

```bash
bash "/c/Users/내이름/Downloads/UPLOAD_GIT_BASH.sh" "/c/Users/내이름/Downloads/Solaris-source"
```

`No such file or directory`는 Bash가 지정된 스크립트 파일을 찾지 못했다는 뜻이다. `ls UPLOAD_GIT_BASH.sh`로 현재 위치의 파일을 확인하거나 위와 같이 스크립트와 소스의 전체 경로를 지정한다. `--dry-run`을 첫 번째 인자로 붙이면 원격 상태/소스와 로컬 커밋만 검증하고 업로드하지 않는다.

현재 검증한 main은 build54 커밋 `4c50dbe33721b5d10db714bd79da74267a8863b4`이고, 기존 build56 브랜치는 `codex/solaris-build56-20261011-155111`, 커밋 `1ff741da6f656411e3bc98054e0f94404d3137a6`이다. 업로더는 두 기준을 모두 확인하고 build56의 Git 기록 위에 별도 `codex/solaris-build57-날짜-PID` 브랜치를 만든다. 둘 중 하나가 바뀌었으면 먼저 새 작업과 소스를 통합하도록 중단한다. 로컬 Git 인덱스로 소스를 선별하므로 `.gitignore`의 빌드 폴더/설정/서명키는 제외한다. 원본 소스 폴더를 변경하지 않으며 기존 코드에서 제거된 파일도 업로드에 반영한다. GitHub 로그인은 사용자의 기존 Git 인증으로 진행한다. main 병합/공식 릴리스는 하지 않는다.

이 업로더의 실제 로컬 Git 업로드/이력 보존/제외 파일/변경된 기준/잘못된 소스/검증 전용 실행/업로드 거절 검사는 9개 통과했다. 실제 Windows Git Bash와 GitHub 원격 업로드는 이번 환경에서 실행하지 않았다. Android 앱 기능/버전은 이전 build57 APK와 같다.

https://github.com/m10180729-afk/solaris-ios-probe/actions 에서 업로드한 build57 실행을 확인한다. 성공 후 아티팩트는 Android APK, `Solaris-Windows-build57-Setup.exe`, `Solaris-0.4.0-build57-resign.ipa`다. Windows는 Setup EXE로 설치하고 iPad/iOS IPA는 기존 AltStore 방식으로 재서명한다. 앱과 방송 확장의 공통 App Group을 유지해야 한다. 이번 로컬 작업에서는 Windows 설치기와 build57 IPA를 생성하지 않았다.

새 Android debug 서명이 기존 설치와 다르면 덮어설치가 거절될 수 있다. 기존 앱을 삭제하기 전에 프로필의 복구 이메일 인증을 완료하고, 같은 소유자 서명키로 빌드/업데이트하는 것이 원칙이다. ID만으로는 계정 복구가 불가능하다. 서명키는 소스 ZIP에 넣지 않았다.

## 아직 Supabase 초기 설정을 하지 않은 경우

- 최초 계정/친구 DB는 `backend/001_solaris.sql`을 사용한다. 기존 build54 테이블을 삭제하지 않는다.
- build55 DB를 이미 사용했다면 기존 `backend/002_build56_broadcast_ready.sql`만 적용한다. build57용 추가 SQL은 없다.
- Anonymous sign-ins를 활성화한다. `public.solaris_action(action text,args jsonb)` RPC 및 비공개 아바타 Storage/RLS가 필요하다. RLS를 끄거나 service-role key를 앱에 넣지 않는다.
- 대용량 파일은 온라인 P2P로 전송한다. 불가능한 NAT에는 TURN이 필요하며 중계 비용은 무료로 보장하지 않는다.

## 튕김/낮은 화질을 다시 확인한 경우

Android에서 앱을 다시 열고 채널 메뉴 → 내 프로필 옆 설정 → 진단 내보내기를 사용한다. 기종, Android 버전, 어느 기기가 송신/수신했는지와 함께 기록한다. Android Logcat의 crash 버퍼도 함께 있으면 네이티브 크래시 원인을 구분할 수 있다. 실제 기기 종료/지속 FPS는 `BUILD57_STATUS_KO.md`의 미검증 항목이다.

전체 요구사항은 `SOLARIS_SPEC_KO.md`, 다음 작업은 `CONTINUE_BUILD57_KO.md`를 읽는다. 작업을 멈추기 전 항상 새 소스 ZIP과 메모를 전달한다.
