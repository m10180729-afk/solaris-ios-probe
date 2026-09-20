# build34 — 검증 범위와 변경
- build33 사용자 보고: 오디오 포함 시 iPad 앱 종료. crash .ips 미제공으로 종료 원인 확정 불가.
- 제공된 sender 진단: audioTracks=0, 캡처 설정 120fps, 실제 인코딩 약 21fps, 약 0.05Mbps. 정지/동작 여부와 인코더 성능을 이 값만으로 확정할 수 없음.
- 기본 WebRTC ADM을 출력 전용 RemoteIO로 교체. 마이크 입력 버스 비활성화, recording 요청 거절. 스테레오 S16 48kHz 출력.
- iPad Metal 렌더러에 화면 지원 주사율 요청. 120fps 표시 보장 아님.
- 실제 RTP codecId로 코덱 식별. 실제 캡처 FPS, 인코더 구현, 인코딩 시간, 대역폭 및 최근 30개 통계 추가.
- Python 43개, Node 25개 통과. iOS 컴파일/오디오 재생/120fps 실기기 미검증.
- macOS Actions 성공 후 같은 build34 IPA와 HTML로 테스트.
- 오디오를 켜고 30초 이상 재생. 프레임은 움직이는 120fps 콘텐츠에서 확인.
- 앱이 다시 종료되면 충돌 시간의 SolarisProbe .ips 필요. 빌드 성공은 재생 성공을 증명하지 않음.
