# 2단계: iPad-Windows P2P WebRTC 연결 검증

목표는 화면공유가 아니라 **WebRTC 직접 연결이 되는지** 확인하는 것입니다.
성공 기준은 Windows와 iPad 사이의 `DataChannel`이 `open`이 되고, 테스트 메시지가 서로 오가는 것입니다.

## 왜 Supabase가 필요한가

WebRTC는 영상·음성을 직접 주고받을 수 있지만, 처음 연결할 때는 서로의 연결 정보가 필요합니다.
Supabase는 이 작은 연결 정보만 교환합니다. 화면 영상이나 음성은 Supabase로 보내지 않습니다.

이번 단계에서는 무료 Supabase 프로젝트 하나와 `anon public key`를 사용합니다.
테스트용 방 ID를 모르면 연결할 수 없지만, 이 설정은 보안 완성판이 아닙니다.

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에 로그인합니다.
2. 새 프로젝트를 만듭니다. 무료 플랜으로 충분합니다.
3. Project URL과 `anon public` key를 복사해 둡니다.
4. SQL Editor를 엽니다.

## 2. 테스트 테이블 만들기

Solaris 앱의 `P2P 연결 테스트` 화면에서 `Supabase SQL 복사`를 누르거나 아래 SQL을 실행합니다.

```sql
create table if not exists public.solaris_signals (
  id bigserial primary key,
  room_id text not null,
  sender text not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.solaris_signals enable row level security;

drop policy if exists "solaristest_select" on public.solaris_signals;
drop policy if exists "solaristest_insert" on public.solaris_signals;

create policy "solaristest_select"
on public.solaris_signals for select
to anon
using (created_at > now() - interval '2 hours');

create policy "solaristest_insert"
on public.solaris_signals for insert
to anon
with check (
  room_id <> ''
  and sender in ('caller', 'callee')
  and kind in ('offer', 'answer', 'ice')
);

create index if not exists solaris_signals_room_id_id_idx
on public.solaris_signals (room_id, id);
```

## 3. Windows에서 caller 열기

Windows에서 아래 파일을 Chrome 또는 Edge로 엽니다.

```text
ios/App/Resources/solaris-p2p.html
```

입력값:

- Supabase Project URL: Supabase에서 복사
- Supabase anon public key: Supabase에서 복사
- 방 ID: 예를 들어 `solaris-test-1`
- 역할: `caller`

`P2P 연결 시작`을 누릅니다.

## 4. iPad에서 callee 열기

1. 새로 빌드한 Solaris Probe를 iPad에 설치합니다.
2. 앱에서 `P2P 연결 테스트 열기`를 누릅니다.
3. Windows와 같은 Supabase URL, anon key, 방 ID를 입력합니다.
4. 역할은 `callee`로 선택합니다.
5. `P2P 연결 시작`을 누릅니다.

## 5. 성공 기준

성공하면 양쪽 화면에 다음 상태가 보입니다.

- `Peer: connected`
- `DataChannel: open`
- `P2P 메시지 받음: ...`

이 상태가 되면 다른 Wi-Fi에서도 최소한 WebRTC 직접 연결 후보가 성립한 것입니다.
단, 일부 학교·통신사·공유기 환경에서는 TURN 서버 없이는 실패할 수 있습니다.

## 6. 실패할 때 보는 것

| 증상 | 의미 |
| --- | --- |
| Supabase 조회 실패 | URL/key 오류, SQL 미실행, RLS 정책 문제 |
| caller가 offer만 보내고 멈춤 | iPad/callee가 같은 방 ID로 시작되지 않음 |
| answer 후에도 ICE failed | 네트워크가 P2P를 막았거나 TURN 필요 |
| DataChannel이 열리지 않음 | 브라우저 WebRTC 제한, STUN 실패, 방 ID 불일치 |

실패하면 양쪽 로그 전체를 캡처해서 전달하세요.
Apple ID, Supabase service_role key, 비밀번호는 절대 공유하지 마세요.
