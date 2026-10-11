# Solaris 이어서 작업할 메모 — build57

이 문서와 ZIP 전체를 다음 대화에서 기준으로 삼는다. 이전 세션의 메모리를 실제 파일/검증 결과보다 우선하지 않는다.

## 사용자 최신 지시

- build54 때의 선명도/FPS가 새 통합 앱에서 떨어졌으므로 즉시 복구한다.
- 방송 품질 선택 UI는 없애고 모두 고화질 기본값을 사용한다.
- Android 방송은 다른 기기에 표시되지만 시청 시작 때 Android가 튕긴다. 정확한 기종/OS/Logcat/송신·수신 방향 정보는 아직 없다.
- 채널 선택과 서버 탈퇴를 확실히 분리하고 Discord와 비슷한 전체 레이아웃/작은 프로필 접속 점을 구현한다.
- 기존 전체 지시서 `SOLARIS_SPEC_KO.md`도 유지한다. 음성통화·마이크 추가 금지, 파일은 원본/청크/P2P, UID 인증과 실제 서버 권한/RLS 유지.
- 계획만 말하지 말고 구현/검증한다. 매 작업 종료/중단 전 최신 소스 ZIP과 인계 파일을 보내 작업 유실을 막는다.
- 최신 추가 요청: 작업을 이어서 진행하고 Git Bash 업로드 코드 파일을 별도 다운로드로 제공한다.

## 이번 수정

`shared/media.mjs`: HIGH_QUALITY 단일 정책(목표 2560×1440/60fps, 시작 25/최대 60Mbps), 다중 시청 수에 따른 저해상도/FPS 강제 조절 제거, 정지 화면 오판 방지, 시청자 비트레이트 요청이 다른 시청자/공통 캡처에 영향을 주지 않도록 변경. native/ReplayKit 엔진 자체를 통째로 교체하지 않았다.

`windows-native/SolarisNativeHost/NativeRtpBroadcast.cs`, `NativeH264Capture.cs`: build54 하드웨어 캡처/RTP/타이머 엔진 재사용. 25/60Mbps 예산, 원본 비율·짝수 크기·최대 1440p급·작은 원본 확대 금지, 해상도/FPS 요청 때문에 공통 인코더를 반복 재시작하지 않음. 포트/ICE/미디어 실제 디코딩은 로컬 권한 제한으로 시험하지 못함.

`ios/Broadcast/UnifiedBroadcastSender.swift`: 기존 bounded frame pump 유지, constrained-baseline H264 최고 지원 레벨 선택, build54의 native 28/60Mbps 및 프레임·해상도 유지 정책 재사용. 시청자들의 최저 품질을 공통 source에 적용하지 않음. build57 Swift는 아직 Xcode 미컴파일.

`android/.../ScreenEngine.java`, `ProjectionService.java`, `SolarisActivity.java`, `CaptureGeometry.java`, `NativeDiagnostics.java`, `DiskBridge.java`: 실제 화면 비율/하드웨어 인코더 지원 검사, baseline H264 우선, 승인 티켓을 1회 소비해 foreground 서비스 시작, 실제 첫 프레임 후 native signaling/ready, 협상 이후 인코딩 파라미터, 캡처/peer 해제 안전 처리, 회전에서 기존 virtual display 크기 변경, WebView renderer 종료 복구, 오류/최근 프로세스 종료 사유를 진단으로 내보냄. 정확한 신고 크래시의 해결 여부는 기기 재현 전 미확정.

`shared/index.html`, `app.css`, `app.mjs`: Discord 구조, 서버와 채널/파괴적 메뉴 분리, 작은 프로필 접속 점, 모바일 채널/참여자 메뉴, 선택된 연결에서만 공유/파일/종료, 친구 삭제/차단 메뉴 분리. 품질 셀렉터 삭제. `prepare_unified.py`로 Android/iOS 번들 동기화 완료.

`UPLOAD_GIT_BASH.sh` 후속 보완: 기존 build56 브랜치에서 시작해 업로드 기록을 연결하고 main/build56 커밋을 모두 검증한다. 다른 위치의 스크립트에 소스 폴더 경로를 인자로 줄 수 있으며 누락/잘못된 iOS·Android 버전을 네트워크 작업 전에 확인한다. 임시 Git 인덱스로 무시된 로컬 설정/서명키/빌드 파일을 제외하고, 이전 빌드에서 제거된 파일도 반영한다. `--dry-run`, 한글/공백 경로, 실패 시 Git 오류 안내를 추가했다. `tests/test_upload_git_bash.py`의 실제 로컬 Git 저장소/원격 9개 시나리오를 통과했다. 별도 UPLOAD_GIT_BASH.sh 파일과 갱신 소스 ZIP/이 메모/검증 ZIP을 제공한다. 이 후속 작업에서는 앱 코드를 바꾸지 않았으며 기존 build57 APK를 사용한다.

## 검증과 제한

최종 수치/검증 범위는 `BUILD57_STATUS_KO.md`를 확인한다. JS 89개, Python 58개(업로더 9개 추가), Android JVM 10개, C# 순수 체크 21개 통과. UI 두 계정/프로필/서버 탈퇴 확인/취소/모바일/반응형 통과. 1GiB 파일 청크·디스크 무결성 통과. Windows 전체 코드 컴파일 및 Android 실제 APK/서명 확인 성공. 후속 업로더 작업에서 Python 프로젝트 전체 49개를 다시 실행했다; 앱 런타임 변경이 없으므로 나머지는 앞선 build57 검증 결과다.

실제 WebRTC/네이티브 RTP 시험은 이 환경에서 인터페이스 탐색 및 NetworkChange 권한 거부로 실패/차단됐다. 성공으로 표시하지 않는다. Windows/iPad/Android 실기기에서 지속 화질/FPS와 Android 종료 해결을 반드시 재시험한다. Android error history만으로 네이티브 SIGSEGV를 해결했다고 말하지 않는다.

## GitHub/DB 상태

- 저장소: `m10180729-afk/solaris-ios-probe`.
- main: build54 `4c50dbe33721b5d10db714bd79da74267a8863b4`.
- 사용자가 올린 build56 브랜치: `codex/solaris-build56-20261011-155111`, commit `1ff741da6f656411e3bc98054e0f94404d3137a6`. Actions run `38119415501` 성공을 이번에 조회했다.
- build57 원격 업로드/CI는 아직 하지 않음. 이번 후속 작업에서도 branches/Actions 조회로 main/build56 기준과 build56 성공을 재확인했다. 이전 GitHub 쓰기 연결은 403이었다. 사용자 업로더는 build56에서 별도 review 브랜치로 올린다. 공식 릴리스/merge/서명 소유권은 사용자에게 둔다.
- Supabase 공개 project ref: `lfwjkaipghctigswxoxq`. 익명 인증/RPC 오류는 이전 초기 설정 문제였으며 사용자가 현재 방송/서버 UI에 진입한 상태다. 운영 DB 변경은 이번 작업에서 하지 않았다.
- 새 migration 없음. build55→56용 `backend/002_build56_broadcast_ready.sql` 이름을 바꾸지 않는다. UID/친구/서버 테이블 삭제/RLS 해제 금지.

## 다음 우선순위

1. build57를 Actions에서 Windows/Android/iOS 모두 빌드하고 실제 설치/캡처/시청을 확인한다. AltStore 공통 App Group과 기존 계정/서명 유지.
2. Android→Windows/iPad 시청 시작 시 종료, Android가 Windows/iPad 시청 시 종료를 각각 구분한다. 재현 시 설정 진단, 기종/OS, `adb logcat -b crash -d`와 실제 stream 통계를 확인해 정확한 네이티브/렌더러/서비스 원인을 수정한다.
3. 실제 원본/수신 해상도·FPS·비트레이트를 기록하며 정지 화면 1분, 회전, 시작 순서, 늦은 참가/재참가/시스템 종료/양방향을 확인한다.
4. 정상 네트워크에서 화면공유+1GiB 원본 파일, 1→5 시청자, 다중 방송의 부하/발열/지연/복구를 시험한다. 목표치와 실측치를 구별한다.
5. Android/Windows 배포 서명키를 소유자가 지속 관리할 수 있도록 구성한다. 다른 debug 서명 때문에 기존 앱을 삭제하라고 바로 지시하지 않는다. 복구 이메일 인증/데이터 보존을 먼저 확인한다.
6. 전체 개발 지시서의 미완료 기능/실기기 테스트는 유지하고, 이번 긴급 수정 완료와 전체 제품 완성을 혼동하지 않는다.

## 재현 명령

```sh
npm ci --ignore-scripts
python3 scripts/prepare_unified.py
npm test
npm run test:database
node --test tests/desktop_share.test.mjs tests/screen_receiver.test.mjs
python3 -m unittest discover -s tests
python3 -m unittest discover -s receiver
node scripts/unified_ui_test.mjs
node scripts/file_stream_test.mjs
dotnet run --project windows-native/Solaris.Transport.Tests -- --unit-only
gradle -p android :app:testDebugUnitTest :app:assembleDebug
python3 scripts/package_source.py
```

실제 네트워크가 가능한 CI/호스트에서 `node scripts/unified_browser_test.mjs`와 `node scripts/native_rtp_browser_test.mjs`도 실행한다. 보호된 런타임 제한을 우회하거나 통과했다고 꾸미지 않는다. 로컬 빌드 도구/프록시/비밀키는 소스 ZIP에 넣지 않는다.
