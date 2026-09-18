# 0.3.2 (build 5) 검사 범위

## 로컬에서 실행한 검사

- Python 방송 설정/IPA 회귀 검사 8개. 올바른 처리 모드 위치, 이전의 잘못된 중첩,
  처리 모드 누락/오류, principal class 오류, 빌드 버전 혼합을 검사합니다.
  IPA 검사의 입력은 합성 ZIP이며, 실행 가능한 앱이 아닙니다.
- Windows 수신기 신호·세션·재시작 검사 12개.
- 기존 LAN 수신기 검사 9개.
- Python 소스, plist/App Group/필수 파일 검사, JavaScript 및 Bash 문법 검사.

총 29개 자동 테스트. 실제 영상 디코딩이나 iOS 컴파일 성공을 의미하지 않습니다.

## GitHub의 필수 단계

1. Linux Chromium에서 합성 화면을 WebRTC로 수신·디코딩·재생하고, 중지 후 새 세션으로 다시 확인.
   공개 STUN 서버 없이 같은 호스트의 두 브라우저 페이지로 수행합니다.
2. 위 로컬 검사, Swift 공유 설정 검사.
3. macOS Xcode의 앱·방송 확장 빌드와 IPA 패키징.
4. 완성된 IPA의 처리 모드, principal class, 번들 관계, 버전, 실행 파일 헤더 검사.

브라우저 실패 시 `browser-failure-diagnostics` 결과물에 상태 JSON과 화면을 저장합니다.
실패를 무시하고 설치용 결과물을 발행하지 않습니다.

## 미검증과 한계

- 이 작업 환경에는 Xcode/Swift/iPad가 없어 0.3.2 컴파일·설치·송출은 실행하지 못했습니다.
- Chromium 다운로드가 네트워크 시간 초과로 실패해 수정된 브라우저 통합 시험은 로컬에서 미실행입니다.
- 이전 0.3.1의 브라우저 timeout이 수정된 테스트로 해결됐다는 실측 결과는 아직 없습니다.
  HTTP 응답이 상대 ICE 수집을 기다리던 테스트 구조는 수정했고, 다음 실패부터 양쪽 상태가 남습니다.
- Supabase 실제 권한, AltStore 재서명 뒤의 앱/확장 권한, ReplayKit 캡처와 기기 메모리는 미검증입니다.
- `Broadcast diagnostics missing`만으로 확장이 시작하지 않았는지, 그룹 접근에 실패했는지는 단정할 수 없습니다.
  0.3.2는 설치 메타데이터와 오류 코드를 추가하지만, 프로세스 로딩 전 종료는 기기 로그가 필요할 수 있습니다.

## 개발자 명령

```sh
python3 scripts/check_project.py
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 -m unittest discover -s receiver -p 'test_*.py' -v
node scripts/check_viewer.mjs
node --test tests/screen_receiver.test.mjs
bash -n scripts/build_ios.sh UPLOAD_GIT_BASH.sh
npm install --no-save --package-lock=false --ignore-scripts playwright@1.51.1
npx playwright install --with-deps chromium
node scripts/screen_browser_test.mjs
```

일반 사용자는 GitHub Actions가 위 검사를 한 번에 실행하므로 각각 실행할 필요가 없습니다.
