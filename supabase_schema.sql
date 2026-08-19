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

-- 역할/가입상태/운영진 권한 (마이그레이션 포함)
alter table public.room_members add column if not exists role text not null default 'member';           -- owner | staff | member
alter table public.room_members add column if not exists status text not null default 'approved';        -- pending | approved
alter table public.room_members add column if not exists can_approve boolean not null default false;      -- 가입승인 권한(운영진)
alter table public.room_members add column if not exists can_reject boolean not null default false;       -- 가입거부 권한(운영진)
alter table public.room_members add column if not exists can_create_event boolean not null default false; -- 정모/번개 생성 권한(운영진)

-- 기존 방장 멤버십을 owner 역할로 복구(마이그레이션 기본값 보정)
update public.room_members m set role = 'owner'
  from public.rooms r
 where m.room_id = r.id and m.user_id = r.host_id and m.role <> 'owner';

create index if not exists room_members_user_idx on public.room_members(user_id);
create index if not exists room_members_status_idx on public.room_members(room_id, status);
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

-- 공개 모임에는 '가입요청'(pending)만 직접 생성 가능. 승인/역할/권한 변경은 아래 함수로만.
-- 비공개 모임 참여는 join_room_with_password() 로만.
drop policy if exists room_members_insert on public.room_members;
create policy room_members_insert on public.room_members
  for insert to authenticated with check (
    user_id = auth.uid()
    and status = 'pending' and role = 'member'
    and can_approve = false and can_reject = false and can_create_event = false
    and exists (select 1 from public.rooms r where r.id = room_id and r.is_private = false)
  );

drop policy if exists room_members_delete on public.room_members;
create policy room_members_delete on public.room_members
  for delete to authenticated using (user_id = auth.uid());

-- ============================================================
--  방 생성 시 방장을 자동으로 참여자에 추가 (편의 트리거)
-- ============================================================
create or replace function public.add_host_as_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.room_members(room_id, user_id, role, status)
  values (new.id, new.host_id, 'owner', 'approved')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_add_host_as_member on public.rooms;
create trigger trg_add_host_as_member
  after insert on public.rooms
  for each row execute function public.add_host_as_member();

-- ============================================================
--  비공개 모임 암호 (해시로 저장, 클라이언트는 절대 읽지 못함)
-- ============================================================
-- pgcrypto (crypt/gen_salt) — Supabase 는 보통 extensions 스키마에 설치됨
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.room_passwords (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  pw_hash text not null
);
-- RLS 켜고 정책을 아예 두지 않음 → 클라이언트는 select/insert 모두 불가.
-- 아래 SECURITY DEFINER 함수만 이 표에 접근한다.
alter table public.room_passwords enable row level security;

-- 방장이 비공개 모임 암호를 설정 (모임 생성 직후 호출)
-- search_path 에 extensions 포함 → gen_salt/crypt 를 찾을 수 있게 함
create or replace function public.set_room_password(p_room_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'not host';
  end if;
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'password too short';
  end if;
  insert into room_passwords(room_id, pw_hash)
  values (p_room_id, crypt(p_password, gen_salt('bf')))
  on conflict (room_id) do update set pw_hash = excluded.pw_hash;
end;
$$;

-- 암호 확인 후 참여 (일치 시 참여자 등록하고 true, 아니면 false)
create or replace function public.join_room_with_password(p_room_id uuid, p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare ok boolean;
begin
  select (pw_hash = crypt(p_password, pw_hash)) into ok
  from room_passwords where room_id = p_room_id;
  if ok is distinct from true then
    return false;
  end if;
  -- 공개·비공개 모두 '가입요청(pending)' → 모임장/운영진 승인 필요
  insert into room_members(room_id, user_id, role, status)
  values (p_room_id, auth.uid(), 'member', 'pending')
  on conflict do nothing;
  return true;
end;
$$;

grant execute on function public.set_room_password(uuid, text) to authenticated;
grant execute on function public.join_room_with_password(uuid, text) to authenticated;

-- ============================================================
--  운영진/가입승인/승계/삭제 관리 함수 (SECURITY DEFINER)
-- ============================================================

-- 요청자에게 특정 권한이 있는지 (owner 는 모든 권한)
create or replace function public.has_room_perm(p_room_id uuid, p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from room_members
    where room_id = p_room_id and user_id = auth.uid() and status = 'approved'
      and ( role = 'owner'
            or (role = 'staff' and (
                 (p_perm = 'approve' and can_approve)
              or (p_perm = 'reject'  and can_reject)
              or (p_perm = 'event'   and can_create_event)
            )))
  );
$$;

-- 가입 승인
create or replace function public.approve_member(p_room_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_room_perm(p_room_id, 'approve') then raise exception 'no permission'; end if;
  update room_members set status = 'approved'
   where room_id = p_room_id and user_id = p_user and status = 'pending';
end;
$$;

-- 가입 거부(요청 삭제)
create or replace function public.reject_member(p_room_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_room_perm(p_room_id, 'reject') then raise exception 'no permission'; end if;
  delete from room_members
   where room_id = p_room_id and user_id = p_user and status = 'pending';
end;
$$;

-- 운영진 지정/권한 설정 (owner 만). p_role: 'staff' | 'member'
create or replace function public.set_member_role(
  p_room_id uuid, p_user uuid, p_role text,
  p_can_approve boolean, p_can_reject boolean, p_can_event boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from room_members
                 where room_id = p_room_id and user_id = auth.uid()
                   and role = 'owner' and status = 'approved') then
    raise exception 'only owner';
  end if;
  if p_role not in ('staff', 'member') then raise exception 'bad role'; end if;
  update room_members
     set role = p_role,
         can_approve = case when p_role = 'staff' then coalesce(p_can_approve,false) else false end,
         can_reject  = case when p_role = 'staff' then coalesce(p_can_reject,false)  else false end,
         can_create_event = case when p_role = 'staff' then coalesce(p_can_event,false) else false end
   where room_id = p_room_id and user_id = p_user and status = 'approved' and role <> 'owner';
end;
$$;

-- 모임장 승계 (owner 만). 대상은 approved 참여자여야 함.
create or replace function public.transfer_ownership(p_room_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from room_members
                 where room_id = p_room_id and user_id = auth.uid()
                   and role = 'owner' and status = 'approved') then
    raise exception 'only owner';
  end if;
  if not exists (select 1 from room_members
                 where room_id = p_room_id and user_id = p_user and status = 'approved') then
    raise exception 'target not member';
  end if;
  -- 기존 모임장 → 일반 참여자
  update room_members set role = 'member', can_approve = false, can_reject = false, can_create_event = false
   where room_id = p_room_id and user_id = auth.uid();
  -- 새 모임장
  update room_members set role = 'owner', can_approve = false, can_reject = false, can_create_event = false
   where room_id = p_room_id and user_id = p_user;
  update rooms set host_id = p_user where id = p_room_id;
end;
$$;

-- 모임 삭제 (owner 만, 다른 참여자가 0명일 때만)
create or replace function public.delete_empty_room(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare others int;
begin
  if not exists (select 1 from rooms where id = p_room_id and host_id = auth.uid()) then
    raise exception 'only owner';
  end if;
  select count(*) into others from room_members
   where room_id = p_room_id and status = 'approved' and role <> 'owner';
  if others > 0 then raise exception 'room not empty'; end if;
  delete from rooms where id = p_room_id;  -- room_members/room_passwords 는 cascade
end;
$$;

grant execute on function public.has_room_perm(uuid, text) to authenticated;
grant execute on function public.approve_member(uuid, uuid) to authenticated;
grant execute on function public.reject_member(uuid, uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.delete_empty_room(uuid) to authenticated;

-- ============================================================
--  게임(정모/번개) : 모임 내 일정. 생성은 '정모/번개 생성' 권한자(owner/운영진)만
-- ============================================================
create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  play_at     timestamptz not null default now(),   -- 일정&시간(미입력 시 오늘/현재)
  location    text,                                  -- 장소(선택)
  courts      int not null default 1 check (courts >= 1),        -- 코트수(최소 1)
  max_players int not null default 4 check (max_players >= 1),   -- 참여자 수
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists games_room_idx on public.games(room_id, play_at);

alter table public.games enable row level security;

drop policy if exists games_select on public.games;
create policy games_select on public.games
  for select to authenticated using (true);

drop policy if exists games_insert on public.games;
create policy games_insert on public.games
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_room_perm(room_id, 'event'));

drop policy if exists games_delete on public.games;
create policy games_delete on public.games
  for delete to authenticated using (public.has_room_perm(room_id, 'event'));

-- ============================================================
--  게임 진행: 참여자 로스터 / 대기·게임중 매치 (코트 운영)
--  모든 변경은 아래 SECURITY DEFINER 함수로만 (권한: has_room_perm 'event')
-- ============================================================
create table if not exists public.game_participants (
  game_id  uuid not null references public.games(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
alter table public.game_participants enable row level security;
drop policy if exists gp_select on public.game_participants;
create policy gp_select on public.game_participants for select to authenticated using (true);

create table if not exists public.matches (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  status     text not null default 'waiting',   -- waiting | playing
  court      int,                                -- 게임중일 때 코트 번호
  created_at timestamptz not null default now()
);
create index if not exists matches_game_idx on public.matches(game_id);
alter table public.matches enable row level security;
drop policy if exists m_select on public.matches;
create policy m_select on public.matches for select to authenticated using (true);

create table if not exists public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (match_id, user_id)
);
alter table public.match_players enable row level security;
drop policy if exists mp_select on public.match_players;
create policy mp_select on public.match_players for select to authenticated using (true);

-- 참여자 추가 (정원 내, 해당 모임의 approved 모임원만)
create or replace function public.add_game_participant(p_game_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid; cap int; cur int;
begin
  select room_id, max_players into rid, cap from games where id = p_game_id;
  if rid is null then raise exception 'no game'; end if;
  if not has_room_perm(rid, 'event') then raise exception 'no permission'; end if;
  if not exists (select 1 from room_members where room_id = rid and user_id = p_user and status = 'approved') then
    raise exception 'not a member';
  end if;
  select count(*) into cur from game_participants where game_id = p_game_id;
  if cur >= cap and not exists (select 1 from game_participants where game_id = p_game_id and user_id = p_user) then
    raise exception 'full';
  end if;
  insert into game_participants(game_id, user_id) values (p_game_id, p_user) on conflict do nothing;
end; $$;

-- 참여자 제외 (매치에 포함돼 있으면 불가)
create or replace function public.remove_game_participant(p_game_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select room_id into rid from games where id = p_game_id;
  if not has_room_perm(rid, 'event') then raise exception 'no permission'; end if;
  if exists (select 1 from match_players mp join matches mm on mm.id = mp.match_id
             where mm.game_id = p_game_id and mp.user_id = p_user) then
    raise exception 'in match';
  end if;
  delete from game_participants where game_id = p_game_id and user_id = p_user;
end; $$;

-- 대기 매치 생성 (정확히 4명, 참여자 & 매치 미중복)
create or replace function public.create_waiting_match(p_game_id uuid, p_users uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; mid uuid; u uuid;
begin
  select room_id into rid from games where id = p_game_id;
  if rid is null then raise exception 'no game'; end if;
  if not has_room_perm(rid, 'event') then raise exception 'no permission'; end if;
  if array_length(p_users, 1) is distinct from 4 then raise exception 'need 4'; end if;
  if exists (select 1 from unnest(p_users) uu
             where uu not in (select user_id from game_participants where game_id = p_game_id)) then
    raise exception 'not participant';
  end if;
  if exists (select 1 from match_players mp join matches mm on mm.id = mp.match_id
             where mm.game_id = p_game_id and mp.user_id = any(p_users)) then
    raise exception 'already in match';
  end if;
  insert into matches(game_id, status) values (p_game_id, 'waiting') returning id into mid;
  foreach u in array p_users loop
    insert into match_players(match_id, user_id) values (mid, u);
  end loop;
  return mid;
end; $$;

-- 코트 지정 → 게임중 (코트 범위/중복 검사)
create or replace function public.assign_match_court(p_match_id uuid, p_court int)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid; gid uuid; ncourts int;
begin
  select g.room_id, g.id, g.courts into rid, gid, ncourts
    from matches m join games g on g.id = m.game_id where m.id = p_match_id;
  if rid is null then raise exception 'no match'; end if;
  if not has_room_perm(rid, 'event') then raise exception 'no permission'; end if;
  if p_court < 1 or p_court > ncourts then raise exception 'bad court'; end if;
  if exists (select 1 from matches where game_id = gid and status = 'playing' and court = p_court and id <> p_match_id) then
    raise exception 'court busy';
  end if;
  update matches set status = 'playing', court = p_court where id = p_match_id;
end; $$;

-- 매치 완료/취소(삭제)
create or replace function public.complete_match(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select g.room_id into rid from matches m join games g on g.id = m.game_id where m.id = p_match_id;
  if rid is null then raise exception 'no match'; end if;
  if not has_room_perm(rid, 'event') then raise exception 'no permission'; end if;
  delete from matches where id = p_match_id;
end; $$;

grant execute on function public.add_game_participant(uuid, uuid) to authenticated;
grant execute on function public.remove_game_participant(uuid, uuid) to authenticated;
grant execute on function public.create_waiting_match(uuid, uuid[]) to authenticated;
grant execute on function public.assign_match_court(uuid, int) to authenticated;
grant execute on function public.complete_match(uuid) to authenticated;

-- ============================================================
--  프로필 사진 저장소 (Supabase Storage 'avatars' 버킷)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 누구나 읽기(공개 버킷), 본인 폴더(<uid>/...)에만 업로드/수정/삭제
drop policy if exists "avatars read"   on storage.objects;
drop policy if exists "avatars insert" on storage.objects;
drop policy if exists "avatars update" on storage.objects;
drop policy if exists "avatars delete" on storage.objects;

create policy "avatars read" on storage.objects
  for select to public using (bucket_id = 'avatars');

create policy "avatars insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- PostgREST 스키마 캐시 새로고침(새 함수 인식)
notify pgrst, 'reload schema';

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
  begin
    alter publication supabase_realtime add table public.games;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.matches;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.match_players;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.game_participants;
  exception when duplicate_object then null;
  end;
end $$;
