# Solaris 0.3.2 build23 — 설치와 확인

이 파일은 build23용입니다. 이전 build7/build19/build20 HTML이나 IPA와 섞지 마세요.
검사 성공은 실제 기기의 60fps 보장을 의미하지 않습니다.

1. 소스 ZIP을 Solaris-0.3.2-build23-source 폴더에 모두 압축 해제합니다.
2. 해당 폴더에서 Git Bash로 bash UPLOAD_GIT_BASH.sh를 실행합니다.
3. 해당 커밋의 GitHub Actions에서 browser-test와 build가 모두 성공해야 합니다.
4. Solaris-0.3.2-build23-app-and-receiver 아티팩트를 다운로드하고 압축 해제합니다.
5. Solaris-0.3.2-build23-resign.ipa를 AltStore로 설치합니다. 방송 확장을 제거하지 마세요.
6. iPad 앱에 0.3.2 (build 23)이 표시되는지 확인합니다.
7. 같은 아티팩트의 Solaris-Windows-0.3.2-build23.html을 Windows에서 엽니다.
8. 기존 Supabase URL·Publishable key·방 ID solaristest1을 그대로 입력합니다.
9. 처음에는 품질 ‘원본 해상도 · 최대 60fps’, 코덱 ‘자동 · 호환성 우선’을 사용합니다.
10. Windows ‘설정 저장 + 수신 시작’ → iPad 방송 버튼 → Solaris 화면 시험 → 공유 시작.
11. 실제 화면이 움직이고 수신 프레임이 증가해야 성공입니다.

## 품질 적용

iPad의 기존 선택기는 공유 저장소 접근 없이 방송 확장에 설정 전달을 보장하지 못해 제거했습니다.
이제 Windows에서 선택 후 ‘품질 저장 / 방송에 적용’을 누릅니다.
‘송신기 적용 확인’은 방송 확장이 같은 요청 ID로 확인 응답을 보내야 표시됩니다.
설정은 브라우저에 저장되며 새 연결 때 다시 전송됩니다.
방송 중에도 적용할 수 있으며 앱 재설치는 필요하지 않습니다.

‘원본’은 ReplayKit이 실제 전달한 픽셀 버퍼 크기입니다. iPad 패널 전체 픽셀 수와
같다는 보장은 없습니다. 긴 변 제한은 화면 비율을 유지하며 업스케일하지 않습니다.
60Mbps는 상한이지 60Mbps를 계속 보내거나 60fps를 보장한다는 뜻이 아닙니다.

## 자동 복구와 진단

기본 코덱은 VP8 우선이며 다른 지원 코덱을 제거하지 않습니다.
H.264 우선은 선택 사항입니다. H.264로 연결된 뒤 실제 영상이 없고 프레임 제출이
확인되면, 연결 10초 이후 같은 세션에서 VP8 우선 재협상을 한 번 시도합니다.
무한 재접속하지 않으며 해상도를 몰래 낮춰 복구하지 않습니다.
Windows 재시작으로 새 세션을 만든 경우 iPad 방송도 중단 후 다시 시작하세요.

- ReplayKit 콜백 FPS: 캡처 입력. 정지 화면에서는 낮을 수 있습니다.
- WebRTC 제출 FPS: 인코더 입력이지 실제 인코딩/수신 FPS가 아닙니다.
- 실제 인코딩: 프레임 수·픽셀 크기·FPS·코덱·전송 바이트·Mbps.
- Windows RTP: 실제 수신/디코딩 해상도·FPS·비트레이트·패킷 손실.
- 요청 출력: 지정한 목표 크기로 실제 인코딩 결과와 구분합니다.

문제가 남으면 ‘진단 한 번에 복사 (키 제외)’에 전체 단계 통계가 포함됩니다.
빌드 실패 시 Solaris-build23-xcode-evidence의 Xcode 로그가 필요합니다.
Apple 계정 비밀번호나 secret/service_role key는 보내지 마세요.
