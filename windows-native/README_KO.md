# Solaris Windows 화면공유 · build40

Moonlight와 Apollo를 설치하지 않습니다. `SolarisNativeHost.exe` 하나를 실행하면 Windows의 Edge WebView2 시스템 구성 요소 안에서 Solaris 송신 화면이 열립니다.

## Windows → iPad

1. GitHub Actions의 `Solaris-Windows-Sender-build40`을 내려받아 압축을 풉니다.
2. `SolarisNativeHost.exe`를 실행합니다.
3. iPad에는 `Solaris-0.3.2-build40-resign.ipa` 하나만 설치합니다.
4. iPad Solaris에서 `Windows 화면 받기` → `Windows 화면 수신 시작`을 누릅니다.
5. Windows에서 기본값인 `Solaris 하드웨어 1080p60` → `Windows 화면 보내기`를 누릅니다.
6. 공유할 모니터와 `시스템 오디오 공유`를 선택합니다.

1080p60이 안정적으로 동작하고 진단의 실제 인코더 출력이 100fps 이상이면 `Solaris 하드웨어 1080p120`을 시험하세요. `호환 1080p60`은 WebCodecs H.264가 없는 PC용 기존 경로입니다.

## 확인할 진단

- 코덱: `avc1... · HW 우선`
- `videoTransport`: `webcodecs-h264`
- 인코더 출력 FPS
- `encoderDrops`
- `dataChannelBufferedBytes`
- iPad 화면의 `VideoToolbox 표시 프레임`과 `손실/지연 드롭`

`HW 우선`은 브라우저에 하드웨어 사용을 요청했다는 뜻입니다. 실제 60/120fps 달성 여부는 전송 중 진단값으로 판단해야 합니다.
