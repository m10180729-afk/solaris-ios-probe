# Solaris build53 설치와 실제 기기 테스트

GitHub Actions의 `native-rtp-test`, `windows-native`, `android-receiver`, `browser-test`, `build` 작업이 모두 성공한 뒤 파일을 받으세요.

1. `Solaris-Windows-Sender-build53`를 전체 압축 해제하고 송신 PC에서 `SolarisNativeHost.exe`를 실행합니다. FFmpeg 파일을 분리하지 마세요.
2. `Solaris-0.3.2-build53-integrated`의 IPA를 iPad에 재서명하여 설치합니다. 다른 Windows 수신기에서는 같은 artifact의 `Solaris-Desktop-Share-build53.html`을 엽니다.
3. Galaxy 폰에 `Solaris-Android-Receiver-build53-debug`의 APK를 설치합니다. Android System WebView를 최신 버전으로 유지하세요. Windows 송신을 볼 때 **Windows 화면 받기**, iPad 방송을 볼 때 **iPad 화면 받기**를 선택합니다.
4. 송신 PC에서 하드웨어 1080p60과 시스템 소리를 켜고 같은 방 ID로 공유를 시작합니다. iPad, 다른 Windows, Galaxy에서 각각 화면 받기를 눌러 2분간 움직임이 많은 영상과 소리를 시청합니다.
5. 방송 중 각 기기의 진단을 복사하고, 한 시청자를 종료·재접속해 다른 시청자 영상이 계속 나오는지 확인합니다. 사용 가능한 기기가 충분할 때 최대 다섯 수신자를 별도로 실험합니다.

`Solaris-Windows-0.3.2-build53.html`은 iPad가 송신한 화면을 받는 기존 Windows 수신기입니다. Android APK는 현재 수신 전용입니다. IPA/Windows/Android 파일 이름과 앱의 빌드 번호가 모두 53인지 확인하세요. 소스 ZIP과 진단 artifact는 설치 파일이 아닙니다.
