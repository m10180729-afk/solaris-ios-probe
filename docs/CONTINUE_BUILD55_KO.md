# 다음 대화에서 바로 이어가기

기준 저장소: https://github.com/m10180729-afk/solaris-ios-probe

기준 build54 커밋: `4c50dbe33721b5d10db714bd79da74267a8863b4`

최신 소스: `Solaris-0.4.0-build55-source.zip`. `shared/`를 수정하고 항상 `python3 scripts/prepare_unified.py`로 Android/iOS 번들을 재생성합니다. 이전 대화의 유실된 작업이 이미 구현되었다고 가정하지 않습니다.

1. `SOLARIS_SPEC_KO.md` 및 `BUILD55_STATUS_KO.md`를 읽습니다. 계정/친구/파일/서버/통합 송수신 구현을 다시 처음부터 만들지 않습니다.
2. GitHub 쓰기 연결을 마련해 검토 브랜치에 업로드합니다. 사용자가 본인 Git Bash에서 ZIP의 `UPLOAD_GIT_BASH.sh`를 실행하는 경로도 있습니다. main이 build54 이후 바뀌었으면 스크립트가 중단하므로 기존 변경을 검토해 병합합니다. force push와 자동 정식 릴리스는 하지 않습니다.
3. Actions의 6개 작업을 확인합니다: 브라우저 권한/UI/5명+양방향/파일, native RTP/Chrome, Windows 설치 EXE, Android APK, macOS 확장 IPA, 1GiB 실제 DataChannel 시험. 빌드 실패 로그를 읽어 수정합니다. 현재 원격 실행 결과가 없습니다.
4. 운영 Supabase의 새 SQL/익명 Auth와 이메일 OTP 템플릿(`{{ .Token }}`)을 설정합니다. 이메일 인증이 같은 UID에 연결되는지와 재설치 복구를 확인합니다. service-role key는 앱에 넣지 않습니다.
5. 소유자가 EXE/APK/재서명 IPA를 기기에 설치해 상태 문서의 조합 시험을 수행합니다. iOS App Group 전달, Android MediaProjection 승인/회전, Windows GPU 인코딩, WK 수신/전체화면을 우선 확인합니다.
6. 실제 1GiB 전송·중단/재개·원본/저장 파일 해시·동시 영상 우선순위를 검증합니다. 현재 1GiB 검증은 디스크/청크 경로이며 실제 P2P가 아닙니다.
7. 미완료된 자동 업데이트/rollback/서명·해시 검증, iOS CPU/메모리 진단, 운영 로그 및 실제 성능 최적화를 구현합니다. 음성통화는 추가하지 않습니다. 핵심 검증 후 정식 UI를 완성합니다.

현재 코드의 주요 경계:

- `backend/001_solaris.sql`: RLS/RPC, 계정·친구·서버·동의/시청 예약 및 신호 권한
- `shared/api.mjs`, `shared/app.mjs`: 인증/프로필/친구/서버·공통 화면
- `shared/media.mjs`: perfect negotiation, ICE/epoch, 품질·다중 시청·native 연결
- `shared/files.mjs`, `shared/sha256.mjs`, `shared/platform.mjs`: 청크·ACK·재개·검증·native disk bridge
- `windows-native/SolarisNativeHost/AppBridge.cs`, `NativeRtpBroadcast.cs`: 보호 세션·파일·H264 다중 송신
- `android/.../SolarisActivity.java`, `ScreenEngine.java`, `DiskBridge.java`: MediaProjection·Keystore·SAF
- `ios/App/UnifiedView.swift`, `ios/Broadcast/UnifiedBroadcastSender.swift`: WK 공통 앱·Keychain/App Group·ReplayKit 5 peers

모든 테스트에 통과했다고 한 번에 보고하지 말고 자동 시험과 실제 장치 시험 결과를 구별합니다.
