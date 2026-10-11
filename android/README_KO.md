# Solaris Android 통합 앱 · build56

`Solaris-Android-build56-debug.apk`는 화면공유 송신·수신과 원본 파일 전송을 하나의 앱에 포함한 테스트 APK입니다. Supabase UID 계정과 친구 동의 또는 서버 채널을 사용합니다. 별도 수신기/방 코드 입력은 필요하지 않습니다. 공유 시작에는 시스템 MediaProjection 승인이 필요하며 마이크·음성통화는 없습니다.

native signaling이 WebView 밖에서 방송 상태와 새 시청자를 처리합니다. 모바일 파일은 일시정지하고 앱 복귀 후 이어받습니다. 실제 캡처/회전/백그라운드/네트워크 시험은 남았습니다. Android System WebView를 최신 상태로 유지하세요.

설정/복구는 [build56 시작 안내](../docs/START_BUILD56_KO.md), 범위는 [build56 상태](../docs/BUILD56_STATUS_KO.md)를 읽습니다. debug APK를 정식 배포·업데이트 검증 완료로 취급하지 않습니다.
