# 0.3.2 시작

이번 버전은 [README](../README.md)와 [화면 방송 안내](STEP3_WEBRTC_SCREEN_KO.md)만 따라 하세요.
옛 1A LAN 테스트, 2A 메시지 테스트를 순서대로 다시 할 필요가 없습니다.

## Git Bash 업로드

Windows에서 ZIP을 `Downloads/Solaris-0.3.2` 폴더에 풀었다면:

```bash
cd ~/Downloads/Solaris-0.3.2
bash UPLOAD_GIT_BASH.sh
```

폴더 이름이 다르면 실제 압축을 푼 폴더에서 Git Bash를 열고
`bash UPLOAD_GIT_BASH.sh`만 실행하세요.

스크립트는 경로/구조를 확인하고 기존 원격 main을 새 폴더로 복제합니다.
현재 작업 중인 기존 폴더를 이동하거나 강제 push하지 않습니다.
실패 시 그 위치에서 멈추고 Git 오류를 표시합니다.
GitHub 계정 인증은 Git의 로그인 창에서 직접 진행합니다.

업로드 후 [Actions](https://github.com/m10180729-afk/solaris-ios-probe/actions)를 확인하세요.
이 버전부터 main에 push하면 자동으로 실행됩니다.
변경 없음으로 끝나고 실행 기록도 없다면 Actions → Build Solaris iOS Probe → Run workflow를 한 번 누르세요.

성공 기록의 Artifacts에서 `Solaris-0.3.2-app-and-receiver`를 받습니다.
압축 안 `SolarisProbe-resign.ipa`를 AltStore로 설치하고, 앱에 0.3.2이 표시되는지 확인하세요.
현재 환경에서는 이 빌드를 대신 실행하지 못했습니다.
