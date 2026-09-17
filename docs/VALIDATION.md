# 확인 결과

이 결과는 제공된 Linux 개발 환경의 검사입니다. **Windows 실기기 또는 iOS 실기기 검사로 해석하면 안 됩니다.**

| 검사 | 결과 | 의미 |
| --- | --- | --- |
| Python 수신기 자동 테스트 | 9개 통과 | HTTP 인증·요청 검증·이미지 바이트 전달·상태 관리 |
| 실제 JPEG 파일 전송·반환 | 바이트 일치 확인 | 로고 원본의 전송 무결성. 브라우저 디코딩/화질 확인은 아님 |
| Python 문법 검사 | 통과 | 포함된 Python 소스 파싱 |
| Info.plist / entitlements 검사 | 통과 | XML 파싱, App Group 문자열 및 방송 확장 설정 일관성 |
| 프로젝트/워크플로 YAML | 파싱·선택 설정 검사 통과 | XcodeGen 생성 또는 GitHub 실행 성공을 뜻하지 않음 |
| PC 미리보기 JavaScript | 문법 검사 통과 | 브라우저 실행·배치 확인은 아님 |
| macOS 빌드 스크립트 | Bash 문법 검사 통과 | 실제 빌드/서명은 미실행 |
| 브라우저 자동 시험 | 미실행 완료 불가 | Playwright 모듈은 있으나 Chromium 실행 파일이 없어서 시작 실패 |
| Swift 공통 설정 테스트 | 미실행 | 현재 환경에 Swift 컴파일러 없음. macOS 워크플로에 포함 |
| XcodeGen / iOS 컴파일 / IPA 패키징 | 미실행 | 현재 환경에 macOS/Xcode 없음 |
| 무료 계정 재서명 / iPadOS 27 설치 | 미실행 | 본인 PC·Apple 계정·기기 필요 |
| ReplayKit 송출 / 음성 / FPS / 발열 | 미실행 | 실제 기기와 후속 단계 필요 |

## 수신기 테스트 범위

1. 토큰 없는 조회/전송 차단, 미리보기 HTML 제공, 캐시 차단 헤더.
2. 프레임 전송과 통계 반환, 오래된 화면 비우기.
3. 잘못된 요청, MIME, 크기, 경로 거부.
4. 다른 Origin/Host 및 동시에 다른 송출 세션 차단.
5. LAN/loopback 주소 허용과 외부/와일드카드 바인딩 거부.
6. 실제 JPEG 파일의 바이트 왕복.
7. 잘못된 프레임·메타데이터·청크 전송 거부.
8. 조회가 없어도 오래된 화면 정리, 종료 후 새 송출 세션 허용.
9. 같은 세션에서 동시 전송 시 상태 일관성.

일부 테스트는 JPEG 시작/끝 표식만 있는 진단 데이터를 사용하며, 이미지 디코딩 시험이 아닙니다.

## 다시 실행하는 명령

프로젝트 최상위 폴더에서:

```sh
python3 scripts/check_project.py
python3 -m unittest discover -s receiver -p 'test_*.py' -v
node scripts/check_viewer.mjs
bash -n scripts/build_ios.sh
```

Windows에서는 Python 명령을 `py -3`로 바꿀 수 있습니다. 수신기 실행에는 Node나 Bash가 필요 없습니다.
`scripts/browser_smoke.mjs`는 선택적인 개발자용 시험입니다. Playwright와 해당 Chromium이 준비된 환경에서만 실행할 수 있으며 일반 사용자가 이를 설치할 필요는 없습니다.

## 아직 확정하지 않은 사항

- 무료 계정으로 이 App Group 구조와 방송 확장을 설치·실행할 수 있는지.
- 실제 OS 27, AltStore 버전, Apple 계정별 제약.
- macOS 러너의 현재 Xcode 버전에서 Swift 소스가 컴파일되는지.
- iPad 로컬 네트워크 권한과 방송 확장의 전송 동작.
- 1080p60: 이번 구현에 없고 시험하지도 않았음.

소스·절차 준비와 1단계 실기기 통과는 다릅니다. 위 미검증 항목을 숨기지 않고, 빌드 또는 설치가 실패하면 그 지점부터 수정합니다.
GitHub 업로드/빌드 실행, 계정 생성, 유료 서비스, 저장소 공개는 수행하지 않았습니다.
