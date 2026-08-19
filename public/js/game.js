// 게임 상세: 참여자(모임원) 로스터 + 대기/게임중 매치(코트 운영)
import { sb } from './supabase.js';
import { store, go } from './app.js';
import { esc, initials, fmtDateTime, toast } from './util.js';

let rootEl = null;
let gctx = null; // { gameId, game, participants, matches, canManage, statusMap }

export async function renderGame(root, gameId) {
  rootEl = root;
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="btn-back" aria-label="뒤로">←</button>
      <div class="app-name">게임</div>
      <div class="top-actions"></div>
    </header>
    <main class="room-detail"><div class="empty">불러오는 중…</div></main>
  `;
  root.querySelector('#btn-back').addEventListener('click', () => history.length ? go('lobby') : go('lobby'));
  await load(gameId);
  subscribe(gameId);
}

async function load(gameId) {
  const [gameRes, partRes, matchRes] = await Promise.all([
    sb.from('games').select('id, room_id, play_at, location, courts, max_players').eq('id', gameId).maybeSingle(),
    sb.from('game_participants').select('user:profiles(id, name, avatar_url)').eq('game_id', gameId),
    sb.from('matches').select('id, status, court, created_at, players:match_players(user:profiles(id, name, avatar_url))').eq('game_id', gameId).order('created_at', { ascending: true }),
  ]);

  const main = rootEl.querySelector('.room-detail');
  if (gameRes.error || !gameRes.data) {
    if (main) main.innerHTML = `<div class="empty">게임을 찾을 수 없어요. (삭제되었을 수 있습니다)</div>`;
    return;
  }
  const game = gameRes.data;
  const permRes = await sb.rpc('has_room_perm', { p_room_id: game.room_id, p_perm: 'event' });
  const canManage = permRes.data === true;

  const participants = (partRes.data || []).map((p) => p.user).filter(Boolean);
  const matches = matchRes.data || [];
  const statusMap = {};
  matches.forEach((m) => (m.players || []).forEach((pp) => { if (pp.user) statusMap[pp.user.id] = m.status; }));

  gctx = { gameId, game, participants, matches, canManage, statusMap };
  rootEl.querySelector('#btn-back').onclick = () => go('room', { roomId: game.room_id });
  renderMain();
}

function statusLabel(uid) {
  const s = gctx.statusMap[uid];
  if (s === 'playing') return ' <span class="badge playing">게임중</span>';
  if (s === 'waiting') return ' <span class="badge wait">참여 대기중</span>';
  return '';
}

function playerNames(m) {
  return (m.players || []).map((p) => `${esc(p.user?.name || '?')}${statusLabel(p.user?.id)}`).join(' · ');
}

function renderMain() {
  const { game, participants, matches, canManage } = gctx;
  const waiting = matches.filter((m) => m.status === 'waiting');
  const playing = matches.filter((m) => m.status === 'playing');
  const main = rootEl.querySelector('.room-detail');

  const playingCnt = participants.filter((u) => gctx.statusMap[u.id] === 'playing').length;
  const waitingCnt = participants.filter((u) => gctx.statusMap[u.id] === 'waiting').length;
  const idleCnt = participants.length - playingCnt - waitingCnt;

  const waitCards = waiting
    .map(
      (m) => `
      <div class="match-card">
        <div class="match-info"><div class="match-players">${playerNames(m)}</div></div>
        ${canManage ? `<div class="match-actions">
          <button class="mini-btn ok" data-assign="${m.id}">코트 지정</button>
          <button class="mini-btn no" data-cancel="${m.id}">취소</button>
        </div>` : ''}
      </div>`
    )
    .join('');

  const playCards = playing
    .map(
      (m) => `
      <div class="match-card playing">
        <div class="match-info">
          <span class="court-tag">코트 ${m.court}</span>
          <div class="match-players">${playerNames(m)}</div>
        </div>
        ${canManage ? `<button class="mini-btn done" data-complete="${m.id}">완료</button>` : ''}
      </div>`
    )
    .join('');

  main.innerHTML = `
    <section class="card room-head-card">
      <h2 class="rh-title">🗓️ ${fmtDateTime(game.play_at)}</h2>
      <div class="rh-meta">
        ${game.location ? `<div>📍 ${esc(game.location)}</div>` : ''}
        <div>🏸 코트 ${game.courts}면 · 정원 ${game.max_players}명</div>
      </div>
    </section>

    <section class="rooms-section">
      <div class="section-head">
        <h2>참석자 (${participants.length}/${game.max_players})</h2>
        <div class="head-actions">
          <button class="mini-btn ghost" id="btn-status">현황</button>
          ${canManage ? `<button class="mini-btn ok" id="btn-add-part">＋ 추가</button>` : ''}
        </div>
      </div>
      <div class="attend-summary">
        <span class="as-play">게임중 ${playingCnt}</span>
        <span class="as-wait">대기중 ${waitingCnt}</span>
        <span class="as-idle">대기가능 ${idleCnt}</span>
      </div>
    </section>

    <section class="rooms-section">
      <div class="section-head">
        <h2>대기 (${waiting.length})</h2>
        ${canManage ? `<button class="mini-btn ok" id="btn-add-wait">＋ 대기 등록</button>` : ''}
      </div>
      ${waiting.length ? `<div class="match-list">${waitCards}</div>` : '<div class="empty">대기 중인 게임이 없어요.</div>'}
    </section>

    <section class="rooms-section">
      <div class="section-head"><h2>게임중 (${playing.length})</h2></div>
      ${playing.length ? `<div class="match-list">${playCards}</div>` : '<div class="empty">진행 중인 게임이 없어요.</div>'}
    </section>
  `;

  const statusBtn = main.querySelector('#btn-status');
  if (statusBtn) statusBtn.addEventListener('click', openStatusDrawer);
  const addPart = main.querySelector('#btn-add-part');
  if (addPart) addPart.addEventListener('click', openAddParticipant);
  const addWait = main.querySelector('#btn-add-wait');
  if (addWait) addWait.addEventListener('click', openAddWaiting);
  main.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => openCourtPicker(b.dataset.assign)));
  main.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => completeMatch(b.dataset.cancel, '취소')));
  main.querySelectorAll('[data-complete]').forEach((b) => b.addEventListener('click', () => completeMatch(b.dataset.complete, '완료')));
}

// ---------- 참석자 현황 사이드바 ----------
function attendeeRowsHTML() {
  const { participants, canManage, statusMap } = gctx;
  if (!participants.length) return '<div class="empty">참석자를 추가해 주세요.</div>';
  return participants
    .map(
      (u) => `
      <div class="member-item">
        <div class="avatar sm">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(initials(u.name))}</div>
        <div class="m-meta"><div class="m-name">${esc(u.name)}${statusLabel(u.id)}</div></div>
        ${canManage && !statusMap[u.id] ? `<button class="mini-btn no" data-rm-part="${u.id}">제외</button>` : ''}
      </div>`
    )
    .join('');
}

function openStatusDrawer() {
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <h3>참석자 현황</h3>
        <button class="icon-btn" id="d-close" aria-label="닫기">✕</button>
      </div>
      <div class="drawer-legend">
        <span class="badge playing">게임중</span>
        <span class="badge wait">참여 대기중</span>
        <span class="badge idle">대기가능</span>
      </div>
      <div class="drawer-body"><div class="member-list" id="d-list"></div></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#d-close').addEventListener('click', close);
  const listEl = overlay.querySelector('#d-list');
  const fill = () => {
    listEl.innerHTML = attendeeRowsHTML();
    listEl.querySelectorAll('[data-rm-part]').forEach((b) =>
      b.addEventListener('click', async () => {
        await removeParticipant(b.dataset.rmPart);
        fill();
      })
    );
  };
  fill();
}

// ---------- 참석자 추가 ----------
async function openAddParticipant() {
  const { game, participants } = gctx;
  const { data } = await sb
    .from('room_members')
    .select('user:profiles(id, name)')
    .eq('room_id', game.room_id)
    .eq('status', 'approved');
  const taken = new Set(participants.map((p) => p.id));
  const candidates = (data || []).map((d) => d.user).filter((u) => u && !taken.has(u.id));
  const remain = game.max_players - participants.length;

  if (!candidates.length) return toast('추가할 모임원이 없어요.', 'info');

  openChecklist({
    title: `참석자 추가 (남은 자리 ${remain})`,
    items: candidates.map((u) => ({ value: u.id, label: u.name })),
    confirmText: '추가',
    onConfirm: async (ids) => {
      if (!ids.length) return toast('추가할 참석자를 선택하세요.', 'error');
      if (ids.length > remain) return toast(`정원이 ${remain}명 남았어요.`, 'error');
      for (const uid of ids) {
        const { error } = await sb.rpc('add_game_participant', { p_game_id: game.id, p_user: uid });
        if (error) { console.error(error); toast('추가 실패: 정원을 확인하세요.', 'error'); break; }
      }
      load(gctx.gameId);
    },
  });
}

// ---------- 대기 등록 (4명) ----------
function openAddWaiting() {
  const available = gctx.participants.filter((u) => !gctx.statusMap[u.id]);
  if (available.length < 4) return toast('대기 등록에는 대기 가능한 참여자 4명이 필요해요.', 'error');

  openChecklist({
    title: '대기 등록 (4명 선택)',
    items: available.map((u) => ({ value: u.id, label: u.name })),
    max: 4,
    confirmText: '대기 등록',
    onConfirm: async (ids) => {
      if (ids.length !== 4) return toast('정확히 4명을 선택하세요.', 'error');
      const { error } = await sb.rpc('create_waiting_match', { p_game_id: gctx.gameId, p_users: ids });
      if (error) { console.error(error); return toast('대기 등록에 실패했습니다.', 'error'); }
      toast('대기에 등록했어요.', 'success');
      load(gctx.gameId);
    },
  });
}

// ---------- 코트 지정 ----------
function openCourtPicker(matchId) {
  const { game, matches } = gctx;
  const busy = new Set(matches.filter((m) => m.status === 'playing').map((m) => m.court));
  const free = [];
  for (let c = 1; c <= game.courts; c++) if (!busy.has(c)) free.push(c);
  if (!free.length) return toast('빈 코트가 없어요.', 'error');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>코트 지정</h3><button class="icon-btn" id="c-close" aria-label="닫기">✕</button></div>
      <div class="modal-body">
        <div class="court-grid">
          ${free.map((c) => `<button class="court-btn" data-court="${c}">코트 ${c}</button>`).join('')}
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#c-close').addEventListener('click', close);
  modal.querySelectorAll('[data-court]').forEach((b) =>
    b.addEventListener('click', async () => {
      const { error } = await sb.rpc('assign_match_court', { p_match_id: matchId, p_court: Number(b.dataset.court) });
      if (error) { console.error(error); return toast('코트 지정에 실패했습니다.', 'error'); }
      close();
      toast(`코트 ${b.dataset.court}에 배정했어요.`, 'success');
      load(gctx.gameId);
    })
  );
}

async function removeParticipant(userId) {
  const { error } = await sb.rpc('remove_game_participant', { p_game_id: gctx.gameId, p_user: userId });
  if (error) { console.error(error); return toast('제외에 실패했습니다.', 'error'); }
  await load(gctx.gameId);
}

async function completeMatch(matchId, verb) {
  if (!confirm(`이 게임을 ${verb}할까요?`)) return;
  const { error } = await sb.rpc('complete_match', { p_match_id: matchId });
  if (error) { console.error(error); return toast(`${verb}에 실패했습니다.`, 'error'); }
  toast(`${verb}했어요.`, 'info');
  load(gctx.gameId);
}

// ---------- 공용 체크리스트 모달 ----------
function openChecklist({ title, items, max, confirmText, onConfirm }) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" id="cl-close" aria-label="닫기">✕</button></div>
      <div class="modal-body">
        <div class="checklist">
          ${items.map((it) => `<label class="check-row"><input type="checkbox" value="${esc(it.value)}"/> <span>${esc(it.label)}</span></label>`).join('')}
        </div>
        <button class="btn btn-primary" id="cl-confirm">${esc(confirmText)}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#cl-close').addEventListener('click', close);

  const boxes = [...modal.querySelectorAll('input[type=checkbox]')];
  if (max) {
    modal.querySelector('.checklist').addEventListener('change', () => {
      const checked = boxes.filter((b) => b.checked);
      boxes.forEach((b) => { if (!b.checked) b.disabled = checked.length >= max; });
    });
  }
  modal.querySelector('#cl-confirm').addEventListener('click', async () => {
    const ids = boxes.filter((b) => b.checked).map((b) => b.value);
    await onConfirm(ids);
    close();
  });
}

// ---------- 실시간 ----------
function subscribe(gameId) {
  const ch = sb
    .channel(`game-${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_participants', filter: `game_id=eq.${gameId}` }, () => load(gameId))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `game_id=eq.${gameId}` }, () => load(gameId))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_players' }, () => load(gameId))
    .subscribe();
  store.channels.push(ch);
}
