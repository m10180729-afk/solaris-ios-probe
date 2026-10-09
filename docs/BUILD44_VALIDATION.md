# build44 검증 메모

## build43 진단에서 확인된 원인

- Windows와 iPad 진단의 세션 ID가 `45437c36-64a6-469f-b297-cd38965640fb`로 일치했다.
- iPad는 4,860개 access unit을 완성해 모두 표시 계층에 넣었고 표시 계층 드롭은 0이었다.
- Windows 송신 큐는 약 2MiB 상한에 도달한 뒤 인코더 드롭이 계속 증가했고, 연결이 disconnected/failed로 전환됐다.
- 따라서 당시 정체의 직접 원인은 iPad 디코더 드롭이 아니라 Windows 송신 큐 포화와 연결 실패였다.
- Windows 네이티브 인코더 통계가 0/null로 보인 것은 C# 메시지의 `message` 필드를 HTML이 읽지 않은 진단 파싱 오류였다.

## build44 변경

- 큐 포화로 access unit 하나를 버리면 다음 키프레임 전까지 delta frame을 보내지 않는다.
- 다음 키프레임부터 다시 전송해 손상된 H.264 예측 체인을 이어 보내지 않는다.
- `awaitingKeyFrame`, `resyncDrops`를 Windows 진단에 추가했다.
- C# 상태 메시지의 실제 인코더 FPS/프레임 수를 파싱한다.
- iPad 진단에 최근 완성 FPS, 전체 평균 완성 FPS, 최근 수신 Mbps 및 측정 시간을 추가했다.
- 네이티브 송신 연결이 failed가 되면 캡처를 중지하고 명시적으로 재시작하도록 안내한다.

## 기기 검증 순서

1. build44 IPA와 Windows Sender를 같은 Actions 실행에서 받는다.
2. 우선 `Solaris 하드웨어 1080p60`만 시험한다.
3. 2분 이상 움직임이 많은 화면을 전송한다.
4. 같은 세션 ID의 Windows/iPad 진단을 각각 복사한다.
5. Windows의 인코더 FPS, 큐 크기, `resyncDrops`와 iPad의 최근/평균 FPS를 함께 비교한다.

1080p120은 build43에서 NVENC/QSV/AMF/MF 모두 첫 프레임 생성에 실패했으므로, 이 PC에서는 1080p60 안정화가 우선이다.
