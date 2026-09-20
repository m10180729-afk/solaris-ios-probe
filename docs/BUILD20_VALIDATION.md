# build20~21 분석과 검증 범위

## 관찰된 사실

사용자 영상 IMG_1601.mp4 (약 20초)에서 iPad build19가 방송을 시작한 뒤
Windows는 connected와 영상 트랙 수신을 표시하지만 영상은 0프레임·0바이트로 남는다.
iPad의 프레임 제출·큐 교체·정책 진단은 데이터 채널을 통해 도착한다.
따라서 연결 자체의 실패나 잘못된 방 ID로 설명할 수 없는 영상 경로 문제다.
영상만으로 실제 H.264 인코더 초기화 실패나 Windows 디코더 결함을 확정할 수는 없다.

## 확인한 코드 결함

1. build19의 preferH264는 H.264와 복구 코덱만 남겼다. 다른 영상 코덱을 제거해
   고해상도 H.264 경로가 실패하면 대안이 없었다. build20은 기본 VP8 우선으로
   복구하고 모든 지원 코덱을 보존한다. H.264는 선택 사항이며 첫 영상이 없을 때
   버전 확인 후 같은 세션에서 VP8로 한 번 재협상한다.
2. SDP 파서는 실제 CRLF 대신 문자 그대로의 역슬래시 r/n을 사용했다.
   코드에 비트레이트 문자열이 존재하는지만 검사했던 테스트는 이 결함을 놓쳤다.
   실제 SDP를 입력하여 출력 변화·영상 영역 한정·중복 방지·프로파일 보존을 검사한다.
3. iPad 호스트 앱의 UserDefaults 선택은 App Group 권한 없는 방송 확장에
   전달을 보장하지 못했다. Windows offer 및 data channel 명령을 사용하고,
   세션과 요청 ID가 일치하는 확장 진단 응답이 있어야 적용 확인을 표시한다.
4. 기존 ‘출력’은 adaptOutputFormat 요청값이었다. 실제 인코딩 통계와 구분하지 않아
   화면은 멈췄는데 원본 해상도로 송출 중인 것처럼 읽혔다. 요청 출력/실제 인코딩/
   실제 수신을 분리하고 framesEncoded·bytesSent·품질 제한 사유를 수집한다.

## 전송 정책

원본 입력 보존, 목표 최대 60fps, 상한 60Mbps를 유지한다. 무제한 전송이나
네트워크 용량과 무관한 60fps 보장은 하지 않는다. 강제 최소/시작 비트레이트는 없앤다.
자동 코덱 복구는 해상도를 낮추지 않는다. 캡처 처리 대기는 최신 1프레임으로 제한한다.
정확한 1/60, 1/30 벽시계 간격으로 재차 제한하지 않고 RTCVideoSource에 FPS 제한을 맡긴다.
VP8에서 높은 CPU 비용이 생길 수 있다. H.264 선호 선택은 가능하지만 그 경로의 기기
성능은 검증 전이다. 새로 수집되는 실제 인코딩/제한 사유로 원인을 좁힐 수 있다.

## 실행한 검사와 미검증

- Python 소스/패키징 구조 및 회귀 테스트.
- Node VM에서 실제 수신기 스크립트를 실행하는 신호/협상/품질/실패 복구 테스트.
- JavaScript 및 Bash 문법 검사, ZIP 무결성 검사.
- WebRTC 153 배포 헤더에서 통계·RTP 파라미터 API를 확인.
- 로컬 Chromium 실행은 브라우저 바이너리가 없어 실패했으며 설치 다운로드도 시간 초과.
  브라우저 통합 검사를 통과했다고 주장하지 않는다.
- 로컬은 Linux이며 Xcode가 없어 iOS 컴파일/IPA 빌드는 수행할 수 없다.

CI는 실제 Chromium에서 1920×1324 합성 입력, 실제 인코딩·디코딩, 재시작,
data channel 품질 명령의 요청 ID 응답을 검사한다. Chromium의 정상적인 초기
대역폭 적응 때문에 수신 해상도가 1920으로 고정된다고 가정하지 않는다.
합성 송신기는 iOS를 대신 검증하지 않는다.
macOS runner에서 Swift 테스트·Xcode 빌드·실제 framework 임베드·IPA 검사를 별도로 수행한다.
build20 Actions에서 합성 원본 1920×1324가 480×331로 적응된 것을 앱 오류로
오판하는 테스트 결함을 확인했다. build23은 원본 크기, 인코딩 프레임 존재,
수신 디코딩·재생을 분리 검증한다. 새 build23 Actions 성공은 업로드 후 확인해야 한다.
무료 재서명, iPad 영상 복구, 지속 60fps는 실제 기기 확인 전까지 미검증이다.

## build29 오디오 진단과 build30 수정

build29 기기 진단은 송신 PCM 4,059,219프레임(48kHz 기준 약 84.6초)을 기록했지만,
Windows는 총 84.69초 중 2,099,572샘플(약 43.7초)을 은폐했고 41.3초를 무음으로
보정했다. 오디오 패킷 손실은 0.57%뿐이어서 네트워크 손실로 이 절반 결손을 설명할
수 없다. 정상 디코딩 시간 약 41초가 송신 PCM 시간의 약 절반인 것은 stereo PCM의
프레임 수와 interleaved sample element 수가 2:1인 것과 일치한다.

WebRTC ObjC 사용자 정의 오디오 장치 API는 미리 채운 `inputData` 또는 WebRTC가
할당한 버퍼를 채우는 `renderBlock` 두 경로를 제공한다. build30은 stereo-safe
`renderBlock` 경로를 사용해 WebRTC가 `frameCount × channelCount` 크기로 할당한
버퍼에 전체 좌·우 PCM을 복사한다. 수신 진단에는 송신 PCM 초, 정상 디코딩 초,
두 값의 비율과 은폐 비율을 함께 기록한다. 실제 기기에서 비율이 1에 근접하고
은폐 비율이 지속적으로 낮은지 확인하기 전에는 해결 완료로 판정하지 않는다.

## 참고한 원자료

- https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpTransceiver/setCodecPreferences
  목록에서 제외한 코덱은 협상 대상에서 빠지며, 변경 후 재협상이 필요하다.
- https://github.com/stasel/WebRTC/releases/tag/153.0.0
  고정 버전 프레임워크 헤더를 기준으로 API를 확인했다.

Supabase URL·publishable key·room ID·테이블 및 RPBroadcastProcessModeSampleBuffer는 유지했다.
