# Solaris 0.4.0 build64

build64은 Discord 공식 공개 UI 이미지와 공통 스타일 값을 참고해 기존 기능의 배치·버튼·설정 창을 정리합니다. [build64 UI 변경](docs/BUILD64_UI_KO.md)을 확인하세요.
build63은 Google 계정 연결 오류가 복귀 뒤 대기 문구로 남는 문제와 인증 초기화 경쟁을 수정한다. 현재 수정·검증 범위는 [build63 인증 수정](docs/BUILD63_AUTH_KO.md)을 따른다. build62 설명은 아래 이전 기능 기록이다.

Discord와 함께 사용하는 Windows·Android·iOS·iPadOS 화면공유 및 일반 파일 전송 앱이다. build62는 Android 공유 승인·취소·재시작 처리, Google 복귀 처리, 오프라인 로그아웃, Windows 창 조절, PC·모바일 탐색과 진단 화면을 개선했다.

- [설치·로그인·화면공유 품질 확인](docs/START_BUILD62_KO.md)
- [구현·실제 검증 범위·미검증 항목](docs/BUILD62_STATUS_KO.md)
- [Galaxy Quantum2 및 최신 Android 기기 시험](docs/ANDROID_BUILD62_DEVICE_CHECK_KO.md)

기존 Solaris test 프로젝트의 build61 DB 마이그레이션 적용을 확인했다. build62에는 새 DB 변경이 없다. 기존 DB에 001_solaris.sql을 재실행하거나 테이블을 삭제하지 않는다. Google·Manual Linking은 켜져 있었으며 Windows·모바일 Redirect URLs 두 개를 소유자의 승인 후 등록했다. 실제 Google 계정 인증·메일 도착은 기기에서 확인해야 한다.

소스 ZIP 전체를 압축 해제한 폴더에서 Git Bash로 실행한다.

```bash
bash UPLOAD_GIT_BASH.sh
```

업로더는 기존 이력을 확인하고 build62 검토 브랜치를 만든다. Actions에서 Windows 설치 EXE, Android APK, iOS 재서명 후보 IPA를 빌드한다. main 강제 덮어쓰기·공식 릴리스는 자동으로 하지 않는다.

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

실제 GPU 캡처 품질/FPS·Android 실기기 공유·메일 도착·Google 계정·iOS 설치는 별도 검증이 필요하다. Windows build54 캡처·전송 엔진 해시는 일치한다. 음성통화는 없으며 일반 파일 상한은 100MiB다. docs의 build55–61 문서는 당시의 기록이므로 현재 설정 상태는 build62 문서를 따른다.
