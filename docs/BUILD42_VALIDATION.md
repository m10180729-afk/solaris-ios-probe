# Solaris 0.3.2 build42 검증

## 변경 목적

build41 진단에서 WebView2가 H.264 WebCodecs Annex-B와 AVCC 구성을 모두 거부했다. build42는 화면 H.264 인코딩을 WebView2 밖의 Windows 네이티브 프로세스로 이동한다.

## 구성

- 화면 선택과 시스템 소리: WebView2 `getDisplayMedia`
- 영상 캡처: FFmpeg `gdigrab` 주 모니터
- 영상 인코더 자동 탐색: NVIDIA NVENC → Intel Quick Sync → AMD AMF → Windows Media Foundation
- 영상 전송: 기존 Solaris 비신뢰성 WebRTC 데이터 채널 `solaris-h264-v1`
- iPad 디코딩: 기존 VideoToolbox/AVSampleBufferDisplayLayer
- 별도 Moonlight/Apollo 설치 없음

## 검증 순서

1. Windows Sender ZIP을 한 폴더에 모두 압축 해제한다.
2. `SolarisNativeHost.exe`를 실행한다. HTML 파일을 직접 열지 않는다.
3. iPad build42에서 Windows 화면 받기를 시작한다.
4. Windows에서 하드웨어 1080p60을 먼저 실행한다.
5. 진단의 `nativeStatus`가 `running`, `nativeEncoder`가 비어 있지 않은지 확인한다.
6. 실제 전송이 55fps 이상으로 유지될 때만 1080p120을 별도 세션에서 시험한다.

## 아직 기기 검증이 필요한 부분

- 각 GPU별 FFmpeg 인코더 옵션 호환성
- 60Mbps 데이터 채널의 장시간 안정성
- 1080p120 캡처 및 전송 달성 여부
- 화면 선택기가 주 모니터 외 화면을 선택했을 때 영상 일치 여부
