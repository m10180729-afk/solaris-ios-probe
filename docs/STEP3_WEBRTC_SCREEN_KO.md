# 3A WebRTC 화면 송신 시험

이 버전은 ReplayKit 방송 확장에서 iPad 화면을 WebRTC 영상 트랙으로 만들어
Windows 브라우저에 직접 전송하는 첫 시험판입니다. Supabase는 SDP/ICE 연결
정보만 전달하며 영상 데이터는 WebRTC P2P로 전송됩니다.

## 시험 순서

1. Windows에서 `ios/App/Resources/solaris-p2p.html`을 Chrome으로 엽니다.
2. Supabase Project URL, Publishable key, 새 방 ID를 입력합니다.
3. Windows 역할을 `caller`로 선택하고 P2P 연결 시작을 누릅니다.
4. iPad Solaris 앱의 `3A · 인터넷 화면공유 송신`에 같은 값을 입력하고 저장합니다.
5. 앱 아래쪽 Apple 방송 버튼을 눌러 `Solaris 화면 시험`을 시작합니다.
6. Windows의 검은 영상 영역에 iPad 화면이 나타나는지 확인합니다.

같은 방 ID에 예전 신호가 남아 있으면 새 방 ID를 사용하세요. 이 시험판은 공용
STUN만 사용하므로 일부 이동통신망이나 엄격한 공유기에서는 TURN 없이 연결에
실패할 수 있습니다. 음성은 다음 단계이며 이 버전에서는 화면 영상만 전송합니다.
