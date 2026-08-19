-- ============================================================
--  배드민턴 웹앱 스키마 (Supabase / Postgres)
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 1회 실행.
--  멱등(idempotent): 여러 번 실행해도 안전하도록 작성.
-- ============================================================

-- ---------- profiles : auth.users 확장 ----------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  username       text unique not null,               -- 아이디(표시·검색용)
  name           text not null,                       -- 이름
  exp_start      date not null,                       -- 구력 시작 년·월(해당 월 1일)
  grade_region   text,                                -- 지역 급수: E|D|C|B|A|S (null=없음)
  grade_national text,                                -- 전국 급수: E|D|C|B|A|S (null=없음)
  avatar_url     text,                                -- 사진(선택)
  created_at     timestamptz not null default now()
);

-- 지역/전국 급수를 각각 입력하도록 변경 (기존 grade/grade_scope 컬럼 마이그레이션)
alter table public.profiles add column if not exists grade_region   text;
alter table public.profiles add column if not exists grade_national text;
alter table public.profiles drop column if exists grade;
alter table public.profiles drop column if exists grade_scope;

-- ---------- rooms : 배드민턴 방 ----------
create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,                         -- 모임명
  host_id      uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'open',         -- open | playing | closed
  location     text,                                  -- (미사용, 하위호환)
  play_at      timestamptz,                           -- (미사용, 하위호환)
  max_members  int not null default 4,                -- 정원(직접 입력)
  is_private   boolean not null default false,        -- 공개(false) / 비공개(true)
  grade_min    text,
  grade_max    text,
  created_at   timestamptz not null default now()
);

-- 공개/비공개 설정 컬럼 (기존 테이블 마이그레이션)
alter table public.rooms add column if not exists is_private boolean not null default false;

-- ---------- room_members : 방 참여자 ----------
create table if not exists public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on public.room_members(user_id);
create index if not exists rooms_status_idx on public.rooms(status);

-- ============================================================
--  RLS (Row Level Security)
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;

-- profiles: 인증 사용자는 전체 조회(로비 표시용), 본인 것만 생성/수정
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- rooms: 인증 사용자 전체 조회, 방장 본인만 생성/수정/삭제
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to authenticated using (true);

drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms
  for insert to authenticated with check (host_id = auth.uid());

drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms
  for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());

drop policy if exists rooms_delete on public.rooms;
create policy rooms_delete on public.rooms
  for delete to authenticated using (host_id = auth.uid());

-- room_members: 인증 사용자 전체 조회, 본인 참여/탈퇴만
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members
  for select to authenticated using (true);

drop policy if exists room_members_insert on public.room_members;
create policy room_members_insert on public.room_members
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists room_members_delete on public.room_members;
create policy room_members_delete on public.room_members
  for delete to authenticated using (user_id = auth.uid());

-- ============================================================
--  방 생성 시 방장을 자동으로 참여자에 추가 (편의 트리거)
-- ============================================================
create or replace function public.add_host_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.room_members(room_id, user_id)
  values (new.id, new.host_id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_add_host_as_member on public.rooms;
create trigger trg_add_host_as_member
  after insert on public.rooms
  for each row execute function public.add_host_as_member();

-- ============================================================
--  Realtime : 변경 사항을 클라이언트로 브로드캐스트할 테이블 등록
-- ============================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.rooms;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.room_members;
  exception when duplicate_object then null;
  end;
end $$;
