# Solaris 0.3.2 build 7 — WebRTC XCFramework 수정 소스

iPad ReplayKit 화면을 Windows HTML 수신기로 보내는 시험 프로젝트입니다.
**이 ZIP은 소스이며, IPA 빌드 성공이나 실제 화면 송출 성공을 뜻하지 않습니다.**

이번 변경은 존재하지 않는 `Release-iphoneos/WebRTC`를 복사하던 설정을
체크섬으로 확인한 실제 `WebRTC.xcframework` 파일 의존성으로 교체합니다.
앱에 중복 임베드하지 않고 방송 확장의 Frameworks에만 넣습니다.
남아 있던 App Group 서명과 앱의 공유 설정 저장 조건도 제거했습니다.
URL·publishable key·방 ID·ReplayKit sample-buffer 모드는 유지했습니다.

## 실행 순서

1. 이 ZIP을 **모두 압축 풀기**로 새 폴더에 풉니다.
2. 그 폴더에서 Git Bash로 `bash UPLOAD_GIT_BASH.sh`를 실행합니다.
3. GitHub Actions의 **이번 커밋**에서 browser-test와 build 모두 성공했는지 확인합니다.
4. `Solaris-0.3.2-build7-app-and-receiver` 아티팩트를 다운로드하고 압축을 풉니다.
5. IPA를 AltStore로 재서명·설치합니다. 방송 확장을 제거하지 마세요.
6. 앱의 **0.3.2 (build 7)** 표시를 확인합니다.
7. iPad에 표시된 URL·방 ID와 복사한 publishable key를 Windows 수신기에 입력합니다.
8. Windows **설정 저장 + 수신 시작** → iPad **Solaris 화면 시험 → 공유 시작**.
9. Windows 영상 프레임 증가와 실제 화면 재생을 확인합니다.

iPad 설정은 확장 번들에 포함된 값을 사용합니다. 이번 빌드의 방 ID는 `solaristest1`입니다.
설정 저장이나 App Group 접근을 요구하지 않습니다. 옛 P2P 테스트 화면은 사용하지 않습니다.

## 검사와 결과

- [이번 변경의 원인·실제 경로·CI 검사·수정 파일](docs/BUILD7_WEBRTC_FIX.md)
- [실행한 검사와 미실행 검사](docs/BUILD7_VALIDATION.md)
- [설치 후 사용 순서](docs/STEP3_WEBRTC_SCREEN_KO.md)

빌드 실패 시 `Solaris-build7-xcode-evidence` 아티팩트의 실제 Xcode 로그와 프로젝트를 확인합니다.
browser-test는 가상 송신기 시험이며, iOS 컴파일이나 ReplayKit 시험을 대신하지 않습니다.
프레임워크 다운로드·실제 복사 원본 확인·동적 링크 확인·IPA 구조 검사 중 하나라도 실패하면
이번 CI는 성공한 IPA를 게시하지 않습니다.

Supabase는 연결 정보를 교환하고 영상은 WebRTC로 전송합니다.
현재 영상 전용이며 오디오·TURN·제품용 사용자 인증은 포함하지 않습니다.
일부 네트워크에서는 직접 연결이 실패할 수 있습니다.
무료 AltStore 재서명 후 설치와 방송 확장 실행은 실기기 확인이 필요합니다.

기존 LAN 수신기와 build 7 이외의 문서는 과거 개발 참고 자료입니다.
현재 설치 및 검증 기준은 위 세 문서를 우선합니다.
