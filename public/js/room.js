// 모임 상세: 참여자 실시간 목록 + 나가기/방장 종료 (MVP)
import { sb } from './supabase.js';
import { store, go } from './app.js';
import { esc, initials, expText, gradeSummary, toast } from './util.js';

export async function renderRoom(root, roomId) {
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="btn-back" aria-label="뒤로">←</button>
      <div class="app-name">모임 정보</div>
      <div class="top-actions"></div>
    </header>
    <main class="room-detail">
      <div class="empty" id="room-loading">불러오는 중…</div>
    </main>
  `;
  root.querySelector('#btn-back').addEventListener('click', () => go('lobby'));

  await load(roomId);
  subscribe(roomId);
}

let currentRoom = null;

async function load(roomId) {
  const { data: room, error } = await sb
    .from('rooms')
    .select('*, host:profiles!rooms_host_id_fkey(name, username)')
    .eq('id', roomId)
    .maybeSingle();

  const main = document.querySelector('.room-detail');
  if (!main) return;
  if (error || !room) {
    main.innerHTML = `<div class="empty">모임을 찾을 수 없어요. (종료되었을 수 있습니다)</div>`;
    return;
  }
  currentRoom = room;

  const { data: members } = await sb
    .from('room_members')
    .select('joined_at, user:profiles(id, name, username, exp_start, grade_region, grade_national, avatar_url)')
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

  const uid = store.session.user.id;
  const isHost = room.host_id === uid;
  const list = members || [];

  main.innerHTML = `
    <section class="card room-head-card">
      <h2 class="rh-title">${esc(room.title)}${room.is_private ? ' <span class="badge private">비공개</span>' : ''}</h2>
      <div class="rh-meta">
        <div>👤 방장 ${esc(room.host?.name || '알 수 없음')}</div>
        <div>👥 ${list.length}/${room.max_members}명</div>
      </div>
    </section>

    <section class="rooms-section">
      <div class="section-head"><h2>참여자</h2></div>
      <div class="member-list" id="member-list">
        ${list
          .map((m) => {
            const u = m.user || {};
            return `
              <div class="member-item">
                <div class="avatar sm">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(initials(u.name))}</div>
                <div class="m-meta">
                  <div class="m-name">${esc(u.name)}${u.id === room.host_id ? ' <span class="badge host">방장</span>' : ''}</div>
                  <div class="m-tags">구력 ${expText(u.exp_start)} · ${esc(gradeSummary(u.grade_region, u.grade_national))}</div>
                </div>
              </div>`;
          })
          .join('')}
      </div>
    </section>

    <div class="room-actions">
      ${
        isHost
          ? `<button class="btn btn-danger" id="btn-close-room">모임 종료</button>`
          : `<button class="btn btn-outline" id="btn-leave">모임 나가기</button>`
      }
    </div>
  `;

  const closeBtn = main.querySelector('#btn-close-room');
  if (closeBtn) closeBtn.addEventListener('click', () => onCloseRoom(roomId));
  const leaveBtn = main.querySelector('#btn-leave');
  if (leaveBtn) leaveBtn.addEventListener('click', () => onLeave(roomId));
}

async function onLeave(roomId) {
  const uid = store.session.user.id;
  const { error } = await sb.from('room_members').delete().eq('room_id', roomId).eq('user_id', uid);
  if (error) {
    console.error(error);
    return toast('나가기에 실패했습니다.', 'error');
  }
  toast('모임에서 나왔어요.', 'info');
  go('lobby');
}

async function onCloseRoom(roomId) {
  if (!confirm('모임을 종료할까요? 참여자 정보가 사라집니다.')) return;
  const { error } = await sb.from('rooms').delete().eq('id', roomId);
  if (error) {
    console.error(error);
    return toast('종료에 실패했습니다.', 'error');
  }
  toast('모임을 종료했어요.', 'info');
  go('lobby');
}

function subscribe(roomId) {
  const ch = sb
    .channel(`room-${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` },
      () => load(roomId)
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      () => {
        toast('방장이 모임을 종료했어요.', 'info');
        go('lobby');
      }
    )
    .subscribe();
  store.channels.push(ch);
}
