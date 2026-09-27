# Solaris Native Host · build38 portable

이 프로그램은 Windows 브라우저의 캡처 및 OpenH264 제한을 우회하는 단일 실행형 네이티브 호스트입니다.
공식 Apollo v0.4.6 GPLv3 엔진이 `engine` 폴더에 포함되므로 Apollo나 winget을 별도로 설치하지 않습니다.

## 최초 시험

1. GitHub Actions의 `Solaris-Native-Host-build38-portable` 아티팩트를 내려받아 완전히 압축 해제합니다.
2. `SolarisNativeHost.exe`를 실행합니다. `engine` 폴더를 옮기거나 삭제하지 마세요.
3. 최초 한 번 `최초 방화벽 허용`을 누르고 관리자 확인 창을 승인합니다.
4. `네이티브 호스트 시작`을 누릅니다. 별도 설치는 진행되지 않습니다.
5. `설정 열기`에서 최초 계정과 페어링을 설정합니다.
6. iPad App Store에서 공식 Moonlight를 열고 PC를 페어링합니다.
7. Moonlight에서 1920×1080, 120fps, 50Mbps로 시작하고 화면 소리는 켜며 마이크 입력은 끕니다.

## 판정

- Moonlight 수신 통계가 실제 100fps 이상이어야 120fps 경로 성공입니다.
- Solaris 엔진 로그에서 NVENC, Quick Sync 또는 AMF 하드웨어 인코더가 확인되어야 합니다.
- OpenH264나 software encoder이면 성공으로 판단하지 않습니다.
- 디스플레이가 60Hz이면 먼저 Windows 디스플레이 설정에서 120Hz 이상을 선택합니다.

`APOLLO_GPLv3_LICENSE.txt`와 `THIRD_PARTY_APOLLO.txt`는 내장 엔진의 라이선스·버전·SHA256·소스 위치입니다.
현재 iPad 수신은 Moonlight로 성능을 검증하며, 후속 단계에서 수신 코어를 Solaris iPad 앱 안으로 통합합니다.
