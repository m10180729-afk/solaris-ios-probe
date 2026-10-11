# Solaris build58 이어가기 메모

프로젝트는 Discord와 함께 사용하는 Windows / iOS / iPadOS / Android 화면공유·원본 대용량 파일 전송 앱입니다. 음성통화를 추가하지 않습니다. 전체 요구사항은 `docs/SOLARIS_SPEC_KO.md`에 있습니다.

최근 사용자 지시: 빌드54와 동일한 화면공유 캡처를 사용해 13fps 저하를 수정하고, Android 튕김과 화면공유 실패, 로그인, 서버·1:1 연결, Discord형 UI를 개선하라. 화질 선택 옵션은 제공하지 않는다. 작업을 멈추기 전에 소스와 업로드 파일을 전달한다. 실제 기기에서 테스트하지 않은 항목을 완료했다고 보고하지 않는다.

## 재개 기준

`Solaris-0.4.0-build58-source.zip` 전체를 사용하세요. APK만으로는 개발을 이어갈 수 없습니다. 새 채팅에 ZIP과 이 메모를 전달하면 됩니다. 파일은 ZIP 루트에 있으므로 업로더를 실행할 때 `shared / ios / android / UPLOAD_GIT_BASH.sh`가 함께 있는 폴더를 선택합니다.

GitHub 저장소: `m10180729-afk/solaris-ios-probe`.

- 빌드54 main: `4c50dbe33721b5d10db714bd79da74267a8863b4`.
- 실제 업로드된 빌드57: `codex/solaris-build57-20261011-192259-1809`, `4ca21efbb32e92e74ff64acadad00d255d92d471`.
- `UPLOAD_GIT_BASH.sh`는 두 기준 HEAD를 검사하고 새로운 빌드58 테스트 브랜치만 업로드합니다. 공식 main 병합과 출시 승인은 소유자의 권한입니다.

현재 소스·설정·빌드 산출물 목표 버전은 0.4.0-build58 / versionCode 58입니다. 이전 빌드54 프로브와 회귀 테스트 페이지는 54 표시를 유지합니다. 55 / 56 / 57 문서는 과거 기록입니다.

## 구현한 내용과 검증

`docs/BUILD58_STATUS_KO.md`에 원본 코드 비교, 변경 사항, 통과한 자동 검사와 미검증 항목을 구분했습니다. `docs/START_BUILD58_KO.md`에 로그인 설정·업로드·설치·실기기 확인 순서를 넣었습니다.

Windows NativeH264Capture.cs는 실제 GitHub 빌드54 파일 전체와 일치합니다. 원래 1080p60 / fast_bilinear / 12–18Mbps를 사용합니다. iOS UnifiedBroadcastSender는 원래 BroadcastWebRTCSender의 팩터리, 트랙, 캡처·프레임 처리 루프를 사용합니다. 캡처 성능을 고칠 때 이 사실을 다시 확인하고 새로운 별도 캡처 경로로 대체하지 마세요.

Android에는 원본 빌드54와 동일한 송신 엔진이 존재했던 것으로 가정하지 마세요. 현재 송신은 MediaProjection과 WebRTC M144입니다. CaptureEpoch는 같은 방송 ID를 재사용한 재시작에서도 이전 콜백을 무효화합니다. 실제 Java / JNI 충돌 여부는 기기 로그와 별도로 확인해야 합니다.

계정은 UID를 권한 기준으로 사용합니다. 신규 이메일 가입, 비밀번호 로그인, 기존 익명 계정 이메일 연결·비밀번호 설정, 코드 복구를 구현했습니다. 서버 프로젝트의 이메일 설정은 자동 테스트로 대신 확인하지 않았습니다. ID만으로 타 계정에 로그인하는 경로를 만들지 마세요.

## 다음 작업

1. 이 ZIP을 업로드하고 **빌드58** Actions 검사 결과를 확인한다. 실패 시 해당 로그에 근거해 수정한다.
2. Windows와 iPad의 움직이는 화면에서 캡처 / 인코딩 / 디코딩 FPS를 각각 측정한다. 소스 일치만으로 60fps 회복을 완료 처리하지 않는다.
3. Android에서 권한 수락, 첫 프레임, 다른 기기의 시청 시작, 회전, 중지·재시작을 재현한다. 진단과 필요 시 `scripts/COLLECT_ANDROID_LOGS_GIT_BASH.sh` 로그로 충돌 구간을 확인한다.
4. 실제 Supabase 이메일 설정 후 기존 UID 유지, 신규 가입, 비밀번호 로그인, 재설치 복구를 확인한다. 인증 토큰과 서명 키를 소스 ZIP에 넣지 않는다.
5. 친구 1:1 양방향 / 방송 시작 순서 / 서버·채널 이동 / 다중 시청과 실제 P2P 파일 전송을 기기에서 확인한다.
6. 같은 서명 키로 업데이트 설치 시 데이터가 유지되는지 확인한다. 다른 서명 APK 설치 문제를 해결하려고 복구 없는 계정을 먼저 삭제하지 않는다.

## 자동 검사 재실행

```bash
python3 scripts/prepare_unified.py
python3 scripts/check_build54_capture.py
npm ci --ignore-scripts
npm test
npm run test:database
node scripts/unified_ui_test.mjs
node --test tests/desktop_share.test.mjs tests/screen_receiver.test.mjs
python3 -m unittest discover -s tests -v
python3 -m unittest discover -s receiver -v
node scripts/file_stream_test.mjs
dotnet run --project windows-native/Solaris.Transport.Tests -- --unit-only
gradle -p android :app:testDebugUnitTest :app:assembleDebug
python3 scripts/package_source.py
```

실제 네트워크 시험을 실행할 수 없는 환경에서는 그 결과를 통과한 것으로 기록하지 마세요.
