# Solaris 0.4.0 build62 사용 안내

build61에서 이어지는 수정 빌드다. 기존 UID·친구·서버·DM을 유지하며 DB 변경은 추가하지 않았다. 기존 앱을 삭제하기 전에 Google 또는 이메일로 현재 계정에 다시 로그인할 수 있는지 확인한다.

## 로그인과 로그아웃

2026-10-12 Solaris test 프로젝트의 Google·Manual Linking 활성화 상태를 확인했다. Redirect URLs가 비어 있어 앱에서 보낸 복귀 주소가 거절되고 Site URL `http://localhost:3000`으로 돌아가는 상태였다. 소유자의 승인 후 아래 두 패턴을 등록하고 저장 결과를 확인했다.

```text
http://127.0.0.1:43854/auth/callback**
solaris://auth/callback**
```

앱에서 로그인 요청을 새로 시작한다. Windows는 시스템 브라우저 인증 후 같은 PC의 Solaris로 돌아오며, Android·iOS는 Solaris 앱 링크를 사용한다. Windows에서 다른 Solaris 창이 복귀 포트를 사용 중이면 오류가 표시된다. 실제 Google 계정 인증은 아직 별도 검증이 필요하다.

ID로 빠르게 시작한 기존 계정의 데이터를 유지하려면 로그인된 상태에서 **설정 → 내 계정 → Google 계정 연결** 또는 이메일 연결을 먼저 완료한다. 처음 화면에서 다른 Google 계정으로 로그인하면 기존 익명 UID로 자동 합쳐지지 않는다.

하단 내 계정 영역과 **설정 → 내 계정**에 로그아웃이 있다. 공유·시청·파일 작업을 종료하고 보호된 로컬 세션과 화면의 개인 정보를 지운다. 인터넷이 끊겨도 로컬 로그아웃은 가능하며, 서버의 종료 응답을 받지 못하면 이를 표시한다. ID 전용 계정은 재접근할 수 없을 수 있으므로 확인 창에서 연결 상태를 먼저 살핀다.

## Windows

포터블 ZIP 전체를 새 폴더에 압축 해제하고 `SolarisNativeHost.exe`를 실행한다. `ffmpeg.exe`를 같은 폴더에 둔다. 기존 설치 폴더나 계정 저장 파일을 지우지 않는다. .NET 런타임을 포함하며 WebView2 런타임이 필요하다.

표준 창 테두리의 최소화·최대화·모서리 크기 조절을 사용할 수 있다. F11로 전체화면을 전환하고 Escape로 나간다. 앱 내부 설정 창도 데스크톱에서는 크기를 조절할 수 있다. 전체화면을 끌 때 창이 테두리 없는 상태로 바뀌던 문제를 수정했다.

## Android

공유 시작 → Android 공유 승인 → 서비스 시작 → 첫 프레임 순서를 지키도록 정리했다. 취소한 이전 승인 결과가 다음 공유에 섞이지 않으며, 이전 공유의 중지 요청이 새 공유를 멈추지 않도록 구분한다. OS가 제공하는 전체 화면·앱 화면 선택을 따른다.

디버그 APK는 기존 APK와 서명이 다르면 덮어쓰기 설치가 거절된다. 먼저 기존 앱에서 계정 연결과 재로그인을 확인한다. 익명 계정을 보존해야 하는 상태에서 앱을 삭제하지 않는다. CI 결과에 APK 공개 서명 지문을 함께 제공한다. 소유자가 관리하는 동일한 서명 키를 사용하는 배포 설정은 별도 작업이다.

Galaxy Quantum2 Android 14와 최신 기기는 [기기 시험표](ANDROID_BUILD62_DEVICE_CHECK_KO.md)를 사용한다. 자동 테스트를 통과했다는 사실만으로 실제 공유가 성공했다고 판단하지 않는다.

## UI와 화면공유 진단

친구 행은 DM과 추가 메뉴로 정리했고, 모바일 화면공유 버튼에 이름을 표시했다. 파일 보내기는 메시지 입력창에서도 사용할 수 있다. 설정의 프로필·내 계정·앱 설정을 한 창에서 이동한다. 받은 공유 요청과 공유 중 상태를 눈에 띄는 영역에 표시한다.

공유를 보는 기기에서 **대화 메뉴 → 연결 및 화면공유 상태**를 연다. 실제 FPS·해상도·비트레이트·손실·RTT와 진단 파일 저장을 사용할 수 있다. 통계를 아직 받지 못하면 0으로 단정하지 않고 미확인 상태를 표시한다. 인증 정보는 진단에서 제거한다.

Windows의 요청 품질은 build54와 같은 1920×1080·60fps·초기 12Mbps·최대 18Mbps다. 핵심 엔진 파일과 공유 품질 정책의 해시도 일치한다. 실제 끊김 원인을 판단하려면 같은 화면을 좋은 Wi-Fi와 현재 인터넷에서 각각 공유하고 송신·수신 양쪽 진단을 비교한다. 수신 FPS 감소에 손실·RTT 증가가 동반되는지, 송신 인코더 FPS부터 낮아지는지 확인한다. 해시 일치는 실제 GPU·네트워크·기기 성능을 보장하지 않는다.

## 소스와 빌드

`shared`가 공통 UI 원본이다. `python3 scripts/prepare_unified.py`로 Android·iOS 리소스를 생성한다. 소스 폴더에서 `bash UPLOAD_GIT_BASH.sh`를 실행하면 검토 브랜치를 만들고 Actions를 시작한다. 업로더가 기준 이력 변경을 감지하면 최신 작업과 통합해야 한다.

Actions 결과는 Windows 설치 파일, Android 디버그 APK와 테스트·서명 증거, iOS 재서명 후보 IPA다. 이번 변경은 자동 병합·공식 출시를 하지 않는다. 현재 시험 결과와 한계는 [build62 상태](BUILD62_STATUS_KO.md)를 따른다.

## 공식 문서

- [Supabase 복귀 주소](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google 인증](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [계정 연결](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Android 화면 공유](https://developer.android.com/media/grow/media-projection)
