# 0.3.1 검사 범위

## 이 작업 환경에서 실행

- 수신기 신호·세션·재시작 자동 테스트 12개 통과.
  초기 ICE, 중복 answer, 잘못된 송신기/세션/프로토콜, 중첩 polling,
  중단 중 HTTP 응답, POST 실패, 재시작, 스트림 없는 영상 트랙,
  디코딩 기반 성공 판단, 진단 키 제외, 설정 검증, offer→ICE 순서를 검사합니다.
- Python 소스/Info.plist/App Group/프로젝트 필수 파일 구조 검사.
- 기존 LAN 수신기 회귀 검사 9개 통과. 합계 21개 자동 테스트 통과.
- JavaScript/Bash 문법 검사 통과.

## GitHub에서 한 번에 실행하도록 구성

- 위 코드 검사와 기존 LAN 수신기 검사.
- Swift 공통 설정 검증.
- 실제 Xcode iOS 앱/방송 확장 컴파일.
- IPA 구조/실행 파일/번들 관계 검사 및 패키징.

## 아직 실행하지 못한 검사

- 이 환경에는 Swift/Xcode가 없어 0.3.1 iOS 컴파일을 실행하지 못했습니다.
- Chromium 기반 합성 영상 시험은 네트워크/브라우저 다운로드에 따라 시간이 걸릴 수 있어 기본 빌드에서 제외했습니다.
  필요할 때만 개발자 명령으로 별도 실행합니다.
- 실제 Supabase 프로젝트 권한/네트워크, AltStore 재서명, iPad 설치 및 ReplayKit 송출은 미검증입니다.
- 합성 영상 브라우저 시험이 통과해도 iPad 캡처/하드웨어 인코더/확장 메모리를 검증한 것은 아닙니다.

## 개발자 재실행

```sh
python3 scripts/check_project.py
python3 -m unittest discover -s receiver -p 'test_*.py' -v
node scripts/check_viewer.mjs
node --test tests/screen_receiver.test.mjs
bash -n scripts/build_ios.sh
npm install --no-save --package-lock=false --ignore-scripts playwright@1.51.1
npx playwright install chromium
node scripts/screen_browser_test.mjs
```

일반 사용자는 이 명령을 하나씩 실행할 필요가 없습니다. GitHub 워크플로가 실행합니다.
