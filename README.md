# Solaris 0.4.0 build61

Discord와 함께 사용하는 Windows·Android·iOS·iPadOS 화면공유 및 일반 파일 전송 앱이다. Google OAuth PKCE와 기존 UID 계정 연결, 이메일 로그인·복구, 프로필 소개, 중복 방송 방지, PC·모바일 Discord형 UI를 추가했다.

- [적용·Google·Supabase·메일·Git Bash 안내](docs/START_BUILD61_KO.md)
- [구현·실제 검증 범위·미검증 항목](docs/BUILD61_STATUS_KO.md)
- [Android 별도 작업 병합 안내](docs/CONTINUE_BUILD61_KO.md)

기존 DB는 003_build60_dm.sql 다음 004_build61_accounts_broadcast.sql을 적용한다. 기존 DB에 001_solaris.sql을 재실행하거나 테이블을 삭제하지 않는다. Google·Redirect URLs·Manual Linking·SMTP는 소유자의 설정이 필요하다.

소스 ZIP 전체를 압축 해제한 폴더에서 Git Bash로 실행한다.

```bash
bash UPLOAD_GIT_BASH.sh
```

업로더는 기존 이력을 확인하고 build61 검토 브랜치를 만든다. Actions에서 Windows 설치 EXE, Android APK, iOS 재서명 후보 IPA를 빌드한다. main 강제 덮어쓰기·공식 릴리스는 자동으로 하지 않는다.

공통 UI 원본은 shared다. python3 scripts/prepare_unified.py로 Android/iOS 리소스를 생성하며 Windows도 shared를 포함한다.

```bash
npm ci
npm test
npm run test:database
node scripts/unified_ui_test.mjs
python3 scripts/check_build54_engine.py
python3 scripts/check_build54_capture.py
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

실제 고화질/FPS·Android capture/crash·메일 도착·Google 계정·iOS 전체 빌드는 별도 검증이 필요하다. 음성통화는 없으며 일반 파일 상한은 100MiB다. docs의 build55–60 문서는 이전 기록이다.
