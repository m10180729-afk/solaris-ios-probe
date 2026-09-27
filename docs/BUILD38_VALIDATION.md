# build38 — Apollo 별도 설치 없는 portable 네이티브 호스트

## 목표

- 사용자는 Apollo, winget 또는 별도 설치 프로그램을 실행하지 않습니다.
- Actions 결과물의 압축을 풀고 `SolarisNativeHost.exe`만 실행합니다.
- 공식 Apollo v0.4.6 엔진은 결과물의 `engine` 폴더에 포함됩니다.

## 자동 검증

- Windows Actions에서 .NET 8 self-contained 런처를 컴파일합니다.
- 공식 GitHub release API에서 고정 태그 v0.4.6의 Windows x64 자산을 받습니다.
- 패키지에서 `sunshine.exe`를 찾아 `dist/native/engine`에 포함했는지 검사합니다.
- GPLv3 라이선스, 공식 소스 링크, 다운로드 자산명과 SHA256을 함께 넣습니다.
- 런처 소스에 winget 또는 별도 설치 호출이 없는지 회귀 테스트합니다.

## 실기기에서 확인할 것

- portable 폴더 전체를 압축 해제했는지 확인합니다.
- 최초 방화벽 허용 후 호스트 설정 페이지가 열리는지 확인합니다.
- 수신 통계가 1920×1080, 100fps 이상인지 확인합니다.
- 엔진 로그가 OpenH264가 아닌 NVENC, Quick Sync 또는 AMF를 표시하는지 확인합니다.

## 아직 남은 범위

내장된 송신 엔진은 Solaris가 직접 실행하지만 GPLv3 Apollo 코어를 사용합니다. iPad 120fps 수신은
아직 공식 Moonlight로 검증합니다. Moonlight 수신 코어를 Solaris iPad 앱에 통합하는 작업은 다음 단계입니다.
