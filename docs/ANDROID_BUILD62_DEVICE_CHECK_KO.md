# Android 실기기 확인 · build62

대상은 Galaxy Quantum2 / Android 14와 사용자가 보유한 최신 Android 기기입니다. 아래 결과는 실제 수정 APK를 설치해 확인한 뒤 기록합니다. 현재 JVM 검사 25개 통과는 캡처·하드웨어 인코더·실제 네트워크 성능을 확인한 결과가 아닙니다.

설치 전 기존 UID와 계정 연결 상태를 기록하세요. CI debug APK의 서명은 이전 설치본과 다를 수 있습니다. 서명이 달라 업데이트가 거부되면 기존 앱을 삭제하지 말고 같은 서명으로 빌드하거나 계정 복구를 먼저 확인합니다.

| 확인 | 기대 결과 / 기록할 정보 |
| --- | --- |
| 시작 전 | 기종, Android 버전, APK 버전, Android System WebView 버전, 송신·시청 기기의 네트워크를 기록합니다. 설정의 진단 내보내기에 대부분 포함됩니다. |
| 전체 화면 공유 | 친구의 승인된 화면공유 세션 또는 서버 채널에서 시작하고 Android 승인 창의 전체 화면을 선택합니다. 홈·설정 등 움직이는 화면이 시청자에게 나타나고 앱 전환 후에도 계속 송출되는지 확인합니다. |
| 앱 하나 공유 | Android 승인 창에서 앱 하나를 선택합니다. 선택한 앱만 송출되고 다른 앱·홈 화면은 송출되지 않는지 확인합니다. |
| 회전 / 화면 크기 | 세로↔가로 회전과 지원 기기의 분할 화면에서 화면 비율을 유지합니다. 캡처 권한 재사용 오류나 앱 종료가 없어야 합니다. |
| 취소 후 재시작 | 승인 창을 취소한 뒤 다시 시작합니다. 첫 승인 결과가 새 방송을 시작하거나 종료하지 않아야 하며 새 요청에는 새 승인이 필요합니다. |
| 연속 시작 / 중지 | 시작 버튼을 연속 누르거나 첫 영상 전에 중지하고 다시 시작합니다. 방송·공유 알림이 하나만 남고 이전 종료 응답이 새 방송을 중지하지 않아야 합니다. |
| 앱·Android에서 중지 | Solaris 중지 버튼과 Android 화면공유 표시에서 각각 중지합니다. 알림·캡처가 종료되고 시청 화면과 시작 버튼이 정상적으로 복구되는지 확인합니다. |
| 공유 중 로그아웃 | 송신 또는 시청 중 로그아웃합니다. 미디어가 종료되고 다음 로그인에서 기존 친구·서버·DM과 UID가 유지되는지 확인합니다. |
| 네트워크 / 품질 | 같은 화면을 같은 Wi-Fi에서 먼저 시험한 뒤 느린 네트워크와 비교합니다. 송신 captureFPS·encodedFPS·qualityLimitationReason과 시청 FPS·손실률·RTT·지터를 함께 기록합니다. 60fps는 요청 목표이며 정지 화면의 낮은 프레임 수만으로 실패를 판단하지 않습니다. |
| 장시간 / 여러 시청자 | 화면이 움직이는 상태로 일정 시간 공유하고 두 명 이상이 시청합니다. 발열·프레임·메모리 변화와 앱 전환 후 복구를 기록합니다. |
| 최신 기기의 16 KB 페이지 | 지원 기기에서 `adb shell getconf PAGE_SIZE`를 기록하고 16384 환경에서도 앱 시작·송신·시청·파일 전송을 확인합니다. APK ZIP 정렬과 WebRTC native ELF LOAD 정렬은 별도로 확인해야 합니다. |

문제가 재현되면 실패 직후 **설정 → 진단 내보내기**를 사용하고, 마지막 성공 단계와 실패 화면을 함께 기록합니다. `projection.failedAt`은 승인·foreground service·첫 프레임 중 어느 단계에서 실패했는지 보존합니다. 앱이 종료되면 다시 실행한 뒤 최근 프로세스 종료 이유를 내보내거나 `scripts/COLLECT_ANDROID_LOGS_GIT_BASH.sh`를 사용합니다.

Android 권한·토큰·서비스 순서는 [Android 공식 MediaProjection 문서](https://developer.android.com/media/grow/media-projection)에 맞춰 유지합니다. Android 14 이상은 세션별 새 승인이 필요하며 승인 토큰으로 virtual display를 반복 생성할 수 없습니다. 현재 WebRTC capturer의 Android 12 이상 크기 변경은 [WebRTC 구현](https://webrtc.googlesource.com/src/+/refs/heads/main/sdk/android/api/org/webrtc/ScreenCapturerAndroid.java)의 기존 virtual display resize 경로를 사용합니다.

최신 기기의 native library 호환성은 [Android 공식 16 KB 페이지 안내](https://developer.android.com/guide/practices/page-sizes)에 따라 ZIP/ELF 정렬과 실제 실행을 함께 확인합니다. CI는 실제 APK의 `arm64-v8a`·`x86_64` ELF LOAD 정렬과 ZIP 16 KB 정렬을 필수 검사하며, legacy 32비트 `armeabi-v7a`·`x86`의 4 KB LOAD 정렬은 경고로 기록합니다. GNU_RELRO 정렬과 실기기 실행은 이 자동 검사에서 확인하지 않으므로 별도 검증이 필요합니다. compileSdk/targetSdk 값만으로 이를 확인했다고 판단하지 않습니다.
