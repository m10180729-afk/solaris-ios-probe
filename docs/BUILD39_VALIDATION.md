# build39 — Solaris 이름의 네이티브 iPad 수신기

## 제공 형태

- Windows: `Solaris-Native-Host-build39-portable` 압축 해제 후 실행
- iPad 네이티브 수신: `Solaris-Native-Receiver-build39-resign.ipa` 설치
- 외부 Apollo 및 Moonlight 앱 설치 없음

## 구현 범위

Actions가 공식 `moonlight-stream/moonlight-ios` 저장소를 submodule까지 내려받아 iPhone/iPad용 Release 앱을 빌드합니다.
빌드된 앱의 표시 이름과 번들 ID를 Solaris Native Receiver로 바꾸고 AltStore 재서명 후보 IPA로 포장합니다.
GPLv3 라이선스와 실제 upstream 커밋을 아티팩트에 포함합니다.

## 제한

빠른 네이티브 성능 검증을 위해 기존 Solaris ReplayKit 송출 앱과 Solaris Native Receiver가 두 IPA로 나뉩니다.
1080p120·오디오·페어링이 확인된 뒤 두 앱을 하나의 Solaris UI로 통합합니다.
