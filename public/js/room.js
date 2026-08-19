// 모임 상세: 가입요청/승인, 역할(모임장·운영진·참여자), 설정 페이지
import { sb } from './supabase.js';
import { store, go } from './app.js';
import { esc, initials, expText, gradeSummary, fmtDateTime, toast } from './util.js';

const PROFILE_COLS = 'id, name, username, exp_start, grade_region, grade_national, avatar_url';
let rootEl = null;
let ctx = null; // { roomId, room, my, myRole, canApprove, canReject, members, pending }

export async function renderRoom(root, roomId) {
  rootEl = root;
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="btn-back" aria-label="뒤로">←</button>
      <div class="app-name">모임 정보</div>
      <div class="top-actions" id="room-top-actions"></div>
    </header>
    <main class="room-detail"><div class="empty">불러오는 중…</div></main>
  `;
  root.querySelector('#btn-back').addEventListener('click', () => go('lobby'));
  await load(roomId);
  subscribe(roomId);
}

async function load(roomId) {
  const uid = store.session.user.id;
  const [roomRes, myRes, memRes] = await Promise.all([
    sb.from('rooms').select('*, host:profiles!rooms_host_id_fkey(id, name, username)').eq('id', roomId).maybeSingle(),
    sb.from('room_members').select('role, status, can_approve, can_reject, can_create_event').eq('room_id', roomId).eq('user_id', uid).maybeSingle(),
    sb.from('room_members').select(`role, status, joined_at, user:profiles(${PROFILE_COLS})`).eq('room_id', roomId).eq('status', 'approved').order('joined_at', { ascending: true }),
  ]);

  const main = rootEl.querySelector('.room-detail');
  if (roomRes.error || !roomRes.data) {
    if (main) main.innerHTML = `<div class="empty">모임을 찾을 수 없어요. (삭제되었을 수 있습니다)</div>`;
    rootEl.querySelector('#room-top-actions').innerHTML = '';
    return;
  }
  const room = roomRes.data;
  const my = myRes.data;
  const myRole = my?.status === 'approved' ? my.role : my?.status === 'pending' ? 'pending' : 'visitor';
  const canApprove = myRole === 'owner' || (myRole === 'staff' && my?.can_approve);
  const canReject = myRole === 'owner' || (myRole === 'staff' && my?.can_reject);

  const canCreateEvent = myRole === 'owner' || (myRole === 'staff' && my?.can_create_event);

  let pending = [];
  if (canApprove || canReject) {
    const { data } = await sb
      .from('room_members')
      .select(`joined_at, user:profiles(${PROFILE_COLS})`)
      .eq('room_id', roomId)
      .eq('status', 'pending')
      .order('joined_at', { ascending: true });
    pending = data || [];
  }

  // 게임(정모/번개) 목록 — 승인된 참여자에게 표시
  let games = [];
  const isApprovedMember = ['owner', 'staff', 'member'].includes(myRole);
  if (isApprovedMember) {
    const { data } = await sb
      .from('games')
      .select('id, play_at, location, courts, max_players, created_by')
      .eq('room_id', roomId)
      .order('play_at', { ascending: true });
    games = data || [];
  }

  ctx = { roomId, room, my, myRole, canApprove, canReject, canCreateEvent, members: memRes.data || [], pending, games };
  renderMain();
}

function roleBadge(role) {
  if (role === 'owner') return ' <span class="badge host">모임장</span>';
  if (role === 'staff') return ' <span class="badge staff">운영진</span>';
  return '';
}

function memberRow(m) {
  const u = m.user || {};
  return `
    <div class="member-item">
      <div class="avatar sm">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(initials(u.name))}</div>
      <div class="m-meta">
        <div class="m-name">${esc(u.name)}${roleBadge(m.role)}</div>
        <div class="m-tags">구력 ${expText(u.exp_start)} · ${esc(gradeSummary(u.grade_region, u.grade_national))}</div>
      </div>
    </div>`;
}

function renderMain() {
  const { room, myRole, members, pending, canApprove, canReject, canCreateEvent, games } = ctx;
  const isApproved = ['owner', 'staff', 'member'].includes(myRole);

  // 상단 액션: + (게임 생성 권한자) · ⚙ (승인된 참여자)
  const actions = rootEl.querySelector('#room-top-actions');
  actions.innerHTML =
    (canCreateEvent ? `<button class="icon-btn" id="btn-add-game" title="게임 만들기" aria-label="게임 만들기">＋</button>` : '') +
    (isApproved ? `<button class="icon-btn" id="btn-room-settings" title="설정" aria-label="설정">⚙️</button>` : '');
  if (canCreateEvent) actions.querySelector('#btn-add-game').addEventListener('click', openGameModal);
  if (isApproved) actions.querySelector('#btn-room-settings').addEventListener('click', openSettings);

  const main = rootEl.querySelector('.room-detail');

  // 액션/상태 영역
  let actionBlock = '';
  if (myRole === 'visitor') {
    actionBlock = room.is_private
      ? `<div class="empty">비공개 모임입니다.</div>`
      : `<div class="room-actions"><button class="btn btn-primary" id="btn-request">가입요청</button></div>`;
  } else if (myRole === 'pending') {
    actionBlock = `
      <section class="card notice-card">
        <div>⏳ 가입 요청을 보냈어요. 모임장·운영진의 승인을 기다리는 중입니다.</div>
      </section>
      <div class="room-actions"><button class="btn btn-outline" id="btn-cancel-req">요청 취소</button></div>`;
  }

  // 가입 요청 목록 (승인/거부 권한자에게만)
  let requestBlock = '';
  if ((canApprove || canReject) && pending.length) {
    requestBlock = `
      <section class="rooms-section">
        <div class="section-head"><h2>가입 요청 (${pending.length})</h2></div>
        <div class="member-list">
          ${pending
            .map((p) => {
              const u = p.user || {};
              return `
                <div class="member-item request">
                  <div class="avatar sm">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(initials(u.name))}</div>
                  <div class="m-meta">
                    <div class="m-name">${esc(u.name)}</div>
                    <div class="m-tags">구력 ${expText(u.exp_start)} · ${esc(gradeSummary(u.grade_region, u.grade_national))}</div>
                  </div>
                  <div class="req-actions">
                    ${canApprove ? `<button class="mini-btn ok" data-approve="${u.id}">승인</button>` : ''}
                    ${canReject ? `<button class="mini-btn no" data-reject="${u.id}">거부</button>` : ''}
                  </div>
                </div>`;
            })
            .join('')}
        </div>
      </section>`;
  }

  // 게임(정모/번개) 목록 (승인된 사람에게만 표시)
  let gameBlock = '';
  if (isApproved) {
    const items = (games || [])
      .map(
        (g) => `
        <div class="game-item">
          <div class="g-main">
            <div class="g-when">🗓️ ${fmtDateTime(g.play_at)}</div>
            <div class="g-sub">
              ${g.location ? `<span>📍 ${esc(g.location)}</span>` : ''}
              <span>🏸 코트 ${g.courts}</span>
              <span>👥 정원 ${g.max_players}명</span>
            </div>
          </div>
          ${canCreateEvent ? `<button class="mini-btn no" data-del-game="${g.id}">삭제</button>` : ''}
        </div>`
      )
      .join('');
    gameBlock = `
      <section class="rooms-section">
        <div class="section-head"><h2>게임 (${games.length})</h2></div>
        ${games.length ? `<div class="game-list">${items}</div>` : `<div class="empty">아직 등록된 게임이 없어요.</div>`}
      </section>`;
  }

  // 모임원 목록 (승인된 사람에게만 표시)
  let memberBlock = '';
  if (isApproved) {
    memberBlock = `
      <section class="rooms-section">
        <div class="section-head"><h2>모임원 (${members.length})</h2></div>
        <div class="member-list">${members.map(memberRow).join('')}</div>
      </section>`;
  }

  main.innerHTML = `
    <section class="card room-head-card">
      <h2 class="rh-title">${esc(room.title)}${room.is_private ? ' <span class="badge private">비공개</span>' : ''}</h2>
      <div class="rh-meta">
        <div>👤 모임장 ${esc(room.host?.name || '알 수 없음')}</div>
        <div>👥 ${members.length}/${room.max_members}명</div>
      </div>
    </section>
    ${actionBlock}
    ${requestBlock}
    ${gameBlock}
    ${memberBlock}
  `;

  // 이벤트 바인딩
  const reqBtn = main.querySelector('#btn-request');
  if (reqBtn) reqBtn.addEventListener('click', onRequestJoin);
  const cancelBtn = main.querySelector('#btn-cancel-req');
  if (cancelBtn) cancelBtn.addEventListener('click', onCancelRequest);
  main.querySelectorAll('[data-approve]').forEach((b) =>
    b.addEventListener('click', () => onApprove(b.dataset.approve))
  );
  main.querySelectorAll('[data-reject]').forEach((b) =>
    b.addEventListener('click', () => onReject(b.dataset.reject))
  );
  main.querySelectorAll('[data-del-game]').forEach((b) =>
    b.addEventListener('click', () => onDeleteGame(b.dataset.delGame))
  );
}

// ---------- 게임(정모/번개) 생성 / 삭제 ----------
function openGameModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>게임 만들기</h3>
        <button class="icon-btn" id="g-close" aria-label="닫기">✕</button>
      </div>
      <form id="game-form" class="modal-body">
        <label class="field"><span>일정 &amp; 시간 (선택)</span>
          <input name="play_at" type="datetime-local" />
          <small class="hint">비워두면 오늘로 등록돼요.</small>
        </label>
        <label class="field"><span>장소 (선택)</span>
          <input name="location" placeholder="예) OO체육관 A코트" maxlength="40" />
        </label>
        <div class="field-row">
          <label class="field"><span>코트수 (최소 1)</span>
            <input name="courts" type="number" inputmode="numeric" min="1" max="50" value="1" required />
          </label>
          <label class="field"><span>참여자 수</span>
            <input name="max_players" type="number" inputmode="numeric" min="1" max="500" value="4" required />
          </label>
        </div>
        <button type="submit" class="btn btn-primary">게임 만들기</button>
      </form>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#g-close').addEventListener('click', close);
  modal.querySelector('#game-form').addEventListener('submit', (e) => onCreateGame(e, close));
}

async function onCreateGame(e, close) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const fd = new FormData(e.target);
  const playRaw = String(fd.get('play_at') || '');
  const play_at = playRaw ? new Date(playRaw).toISOString() : new Date().toISOString(); // 미입력 시 오늘
  const location = String(fd.get('location') || '').trim() || null;
  const courts = Math.max(1, Number(fd.get('courts')) || 1);
  const max_players = Math.max(1, Number(fd.get('max_players')) || 1);

  btn.disabled = true;
  btn.textContent = '생성 중…';
  const { error } = await sb.from('games').insert({
    room_id: ctx.roomId,
    play_at,
    location,
    courts,
    max_players,
    created_by: store.session.user.id,
  });
  btn.disabled = false;
  btn.textContent = '게임 만들기';
  if (error) {
    console.error(error);
    return toast('게임 생성에 실패했습니다.', 'error');
  }
  close();
  toast('게임을 만들었어요!', 'success');
  load(ctx.roomId);
}

async function onDeleteGame(gameId) {
  if (!confirm('이 게임을 삭제할까요?')) return;
  const { error } = await sb.from('games').delete().eq('id', gameId);
  if (error) {
    console.error(error);
    return toast('삭제에 실패했습니다.', 'error');
  }
  toast('게임을 삭제했어요.', 'info');
  load(ctx.roomId);
}

// ---------- 가입요청 / 취소 ----------
async function onRequestJoin() {
  const uid = store.session.user.id;
  const { error } = await sb.from('room_members').insert({
    room_id: ctx.roomId,
    user_id: uid,
    status: 'pending',
    role: 'member',
  });
  if (error) {
    console.error(error);
    return toast('가입요청에 실패했습니다.', 'error');
  }
  toast('가입 요청을 보냈어요!', 'success');
  load(ctx.roomId);
}

async function onCancelRequest() {
  const uid = store.session.user.id;
  const { error } = await sb.from('room_members').delete().eq('room_id', ctx.roomId).eq('user_id', uid);
  if (error) {
    console.error(error);
    return toast('취소에 실패했습니다.', 'error');
  }
  toast('요청을 취소했어요.', 'info');
  load(ctx.roomId);
}

// ---------- 승인 / 거부 ----------
async function onApprove(userId) {
  const { error } = await sb.rpc('approve_member', { p_room_id: ctx.roomId, p_user: userId });
  if (error) {
    console.error(error);
    return toast('승인에 실패했습니다.', 'error');
  }
  toast('가입을 승인했어요.', 'success');
  load(ctx.roomId);
}

async function onReject(userId) {
  const { error } = await sb.rpc('reject_member', { p_room_id: ctx.roomId, p_user: userId });
  if (error) {
    console.error(error);
    return toast('거부에 실패했습니다.', 'error');
  }
  toast('가입을 거부했어요.', 'info');
  load(ctx.roomId);
}

// ---------- 설정 페이지 ----------
function openSettings() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>모임 설정</h3>
        <button class="icon-btn" id="s-close" aria-label="닫기">✕</button>
      </div>
      <div class="modal-body" id="settings-body"><div class="empty">불러오는 중…</div></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#s-close').addEventListener('click', close);
  buildSettings(overlay, close);
}

function buildSettings(overlay, close) {
  const body = overlay.querySelector('#settings-body');
  const { room, myRole, members } = ctx;
  const isOwner = myRole === 'owner';
  const others = members.filter((m) => m.role !== 'owner'); // 모임장 제외 참여자

  if (!isOwner) {
    // 일반 참여자/운영진: 모임 탈퇴
    body.innerHTML = `
      <p class="settings-note">모임에서 나가면 다시 가입요청을 해야 합니다.</p>
      <button class="btn btn-danger" id="btn-leave">모임 탈퇴</button>`;
    body.querySelector('#btn-leave').addEventListener('click', async () => {
      const uid = store.session.user.id;
      const { error } = await sb.from('room_members').delete().eq('room_id', ctx.roomId).eq('user_id', uid);
      if (error) { console.error(error); return toast('탈퇴에 실패했습니다.', 'error'); }
      close();
      toast('모임에서 나왔어요.', 'info');
      go('lobby');
    });
    return;
  }

  // ---- 모임장 설정 ----
  const staffRows = others
    .map((m) => {
      const u = m.user || {};
      const isStaff = m.role === 'staff';
      return `
        <div class="staff-row" data-user="${u.id}">
          <div class="staff-top">
            <div class="staff-name">${esc(u.name)}${isStaff ? ' <span class="badge staff">운영진</span>' : ''}</div>
            <label class="switch"><input type="checkbox" class="staff-toggle" ${isStaff ? 'checked' : ''}/><span>운영진</span></label>
          </div>
          <div class="perm-row" style="${isStaff ? '' : 'display:none'}">
            <label><input type="checkbox" class="perm" data-perm="approve" ${m.can_approve ? 'checked' : ''}/> 가입승인</label>
            <label><input type="checkbox" class="perm" data-perm="reject" ${m.can_reject ? 'checked' : ''}/> 가입거부</label>
            <label><input type="checkbox" class="perm" data-perm="event" ${m.can_create_event ? 'checked' : ''}/> 정모·번개 생성</label>
          </div>
        </div>`;
    })
    .join('');

  const transferOpts = others.map((m) => `<option value="${m.user.id}">${esc(m.user.name)}</option>`).join('');
  const canDelete = others.length === 0;

  body.innerHTML = `
    <section class="settings-sec">
      <h4>운영진 관리</h4>
      ${others.length ? `<div class="staff-list">${staffRows}</div>` : `<p class="settings-note">아직 다른 참여자가 없어요.</p>`}
    </section>

    <section class="settings-sec">
      <h4>모임장 승계</h4>
      ${
        others.length
          ? `<div class="inline-row">
               <select id="transfer-sel">${transferOpts}</select>
               <button class="btn btn-outline compact" id="btn-transfer">승계</button>
             </div>
             <p class="settings-note">선택한 참여자에게 모임장을 넘깁니다. (되돌릴 수 없어요)</p>`
          : `<p class="settings-note">승계할 참여자가 없어요.</p>`
      }
    </section>

    <section class="settings-sec">
      <h4>모임 삭제</h4>
      <button class="btn btn-danger" id="btn-delete" ${canDelete ? '' : 'disabled'}>모임 삭제</button>
      <p class="settings-note">${canDelete ? '이 모임을 영구 삭제합니다.' : '참여자가 모두 나가야 삭제할 수 있어요. (모임장 외 0명)'}</p>
    </section>
  `;

  // 운영진 토글/권한 저장
  body.querySelectorAll('.staff-row').forEach((row) => {
    const userId = row.dataset.user;
    const toggle = row.querySelector('.staff-toggle');
    const permRow = row.querySelector('.perm-row');
    const save = async () => {
      const role = toggle.checked ? 'staff' : 'member';
      const perms = {};
      row.querySelectorAll('.perm').forEach((p) => (perms[p.dataset.perm] = p.checked));
      const { error } = await sb.rpc('set_member_role', {
        p_room_id: ctx.roomId,
        p_user: userId,
        p_role: role,
        p_can_approve: !!perms.approve,
        p_can_reject: !!perms.reject,
        p_can_event: !!perms.event,
      });
      if (error) { console.error(error); toast('저장에 실패했습니다.', 'error'); }
    };
    toggle.addEventListener('change', () => {
      permRow.style.display = toggle.checked ? '' : 'none';
      if (!toggle.checked) row.querySelectorAll('.perm').forEach((p) => (p.checked = false));
      save();
    });
    row.querySelectorAll('.perm').forEach((p) => p.addEventListener('change', save));
  });

  // 승계
  const transferBtn = body.querySelector('#btn-transfer');
  if (transferBtn)
    transferBtn.addEventListener('click', async () => {
      const target = body.querySelector('#transfer-sel').value;
      if (!confirm('정말 이 참여자에게 모임장을 넘길까요?')) return;
      const { error } = await sb.rpc('transfer_ownership', { p_room_id: ctx.roomId, p_user: target });
      if (error) { console.error(error); return toast('승계에 실패했습니다.', 'error'); }
      close();
      toast('모임장을 넘겼어요.', 'success');
      load(ctx.roomId);
    });

  // 삭제
  const deleteBtn = body.querySelector('#btn-delete');
  if (deleteBtn && canDelete)
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('이 모임을 삭제할까요? 되돌릴 수 없습니다.')) return;
      const { error } = await sb.rpc('delete_empty_room', { p_room_id: ctx.roomId });
      if (error) { console.error(error); return toast('삭제에 실패했습니다.', 'error'); }
      close();
      toast('모임을 삭제했어요.', 'info');
      go('lobby');
    });
}

// ---------- 실시간 ----------
function subscribe(roomId) {
  const ch = sb
    .channel(`room-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` }, () => load(roomId))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `room_id=eq.${roomId}` }, () => load(roomId))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () => {
      toast('모임이 종료되었어요.', 'info');
      go('lobby');
    })
    .subscribe();
  store.channels.push(ch);
}
