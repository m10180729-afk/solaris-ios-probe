# Solaris 0.3.2 build 7 — 설치와 확인

이 ZIP은 수정 소스입니다. 이 전달 시점에는 macOS IPA 빌드와 iPad 실기기 검증이 완료되지 않았습니다.
browser-test 성공만으로 iOS 빌드 성공이라고 판단하지 마세요.

1. ZIP을 다운로드하고 **모두 압축 풀기**로 새 폴더에 풉니다.
2. 새 폴더의 UPLOAD_GIT_BASH.sh를 Git Bash에서 실행합니다.
3. GitHub Actions에서 이번 커밋의 browser-test와 build 두 작업이 모두 성공해야 합니다.
4. 성공한 실행의 Solaris-0.3.2-build17-app-and-receiver 아티팩트를 다운로드합니다.
5. 압축을 푼 SolarisProbe-resign.ipa를 AltStore로 재서명·설치합니다. 확장을 제거하지 마세요.
6. iPad 첫 화면이 **0.3.2 (build 7)**인지 확인합니다.
7. iPad에 표시된 Project URL, 방 ID와 ‘Publishable key 복사’의 값을 Windows에 입력합니다.
   이 빌드의 방 ID는 기존 설정 그대로 **solaristest1**입니다.
8. Windows에서 함께 제공된 Solaris-Windows-0.3.2.html을 열고 ‘설정 저장 + 수신 시작’을 누릅니다.
9. iPad의 방송 버튼 → Solaris 화면 시험 → 공유 시작을 누릅니다.
10. Windows의 영상 프레임 수가 증가하고 화면이 움직여야 화면 전송 성공입니다.

앱은 확장 번들에 포함된 설정을 보여줍니다. App Group 설정 저장과 공유 진단 파일은 사용하지 않습니다.
현재 URL·publishable key·방 ID는 변경하지 않았습니다. P2P 테스트 화면은 열지 않습니다.
실행 중 설정을 수정하는 기능은 이 빌드에 없습니다.

빌드 실패 시 같은 ZIP으로 반복 업로드하지 마세요.
실패한 실행에서 **Solaris-build17-xcode-evidence** 아티팩트를 받아 전달하면
실제 project.pbxproj, dependency.log, generated-project.log, xcodebuild.log,
생성된 경우 Build.xcresult와 패키징 검사를 확인할 수 있습니다.
비밀 키나 Apple 계정 비밀번호는 보내지 마세요.

빌드는 성공했으나 화면이 없으면 Windows ‘진단 한 번에 복사’와 iPad ‘설치 정보 복사’를 전달하세요.
iPad 설치 정보는 확장의 실제 실행 성공을 증명하지 않습니다.
무료 재서명 후 설치·동적 라이브러리 로딩·ReplayKit 캡처는 실기기 확인이 필요합니다.
기존 공유 파일 읽기 오류 260만으로 App Group이 근본 원인이었다고 단정할 수 없습니다.
