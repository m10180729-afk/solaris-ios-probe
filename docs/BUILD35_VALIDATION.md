# build35 — Windows→iPad 1080p120 진단과 변경

- build34 실측에서 Windows 캡처는 1920×1080·120fps를 요청했지만 실제 캡처/인코딩은 12–24fps였습니다.
- 송신 인코더는 `OpenH264`, `powerEfficientEncoder=false`, 프레임당 인코딩 시간은 24–61ms였습니다. 120fps에 필요한 프레임 예산은 8.3ms입니다.
- 협상 결과가 H.264 level 4.1(`42e029`)이어서 1080p120에 필요한 level 5.1보다 낮았습니다.
- build35는 iPad answer의 H.264 profile level을 5.1로 맞추고 Windows offer에 20Mbps 시작, 8Mbps 최소, 80Mbps 최대 힌트를 추가합니다.
- 해상도 승격 지연을 줄이기 위해 브라우저 송신의 열화 우선순위를 해상도 유지로 설정합니다.
- 진단에서 OpenH264가 감지되면 GPU 하드웨어 인코더가 사용되지 않았음을 화면에 명시합니다.
- 이 변경은 GPU 인코더를 JavaScript로 강제하지 않습니다. 진단의 `encoderImplementation`이 OpenH264이면 Edge/Chrome 그래픽 가속, Windows 고성능 GPU 지정, GPU 드라이버 확인이 필요합니다.
- Python/Node 정적·회귀 검사와 macOS GitHub Actions Xcode 빌드 후 실기기에서 검증합니다.
