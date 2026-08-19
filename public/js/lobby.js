// 로비 화면: 상단바 + 프로필 카드 + 방 생성/찾기/현황(실시간)
import { sb } from './supabase.js';
import { store, go, clearChannels } from './app.js';
import {
  GRADES, expText, gradeSummary, gradeLabel, esc, initials,
  fmtDateTime, toast, h,
} from './util.js';

let searchText = '';

export function renderLobby(root) {
  const p = store.profile;
  root.innerHTML = `
    <header class="topbar">
      <div class="app-name"><span class="app-mark">🏸</span> 라켓로비</div>
      <div class="top-actions">
        <button class="icon-btn" id="btn-noti" title="알림" aria-label="알림">🔔</button>
        <button class="icon-btn" id="btn-settings" title="설정" aria-label="설정">⚙️</button>
      </div>
    </header>

    <main class="lobby">
      <section class="profile-card">
        <div class="avatar">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(initials(p.name))}</div>
        <div class="profile-meta">
          <div class="p-name">${esc(p.name)} <span class="p-username">@${esc(p.username)}</span></div>
          <div class="p-tags">
            <span class="tag tag-exp">구력 ${expText(p.exp_start)}</span>
            <span class="tag tag-grade">${esc(gradeSummary(p.grade_region, p.grade_national))}</span>
          </div>
        </div>
      </section>

      <section class="status-row">
        <div class="stat">
          <div class="stat-num" id="stat-online">–</div>
          <div class="stat-label">접속 중</div>
        </div>
        <div class="stat">
          <div class="stat-num" id="stat-rooms">–</div>
          <div class="stat-label">열린 방</div>
        </div>
        <button class="stat stat-cta" id="btn-create">
          <div class="stat-num">＋</div>
          <div class="stat-label">방 만들기</div>
        </button>
      </section>

      <section class="rooms-section">
        <div class="section-head">
          <h2>방 찾기</h2>
          <input class="search" id="room-search" placeholder="방 제목·장소 검색" />
        </div>
        <div class="room-list" id="room-list">
          <div class="empty">불러오는 중…</div>
        </div>
      </section>
    </main>
  `;

  root.querySelector('#btn-noti').addEventListener('click', () => toast('알림 기능은 준비 중이에요.', 'info'));
  root.querySelector('#btn-settings').addEventListener('click', openSettings);
  root.querySelector('#btn-create').addEventListener('click', openCreateModal);
  const search = root.querySelector('#room-search');
  search.value = searchText;
  search.addEventListener('input', () => {
    searchText = search.value.trim().toLowerCase();
    paintRooms();
  });

  loadRooms();
  subscribeRealtime();
}

// ---------- 방 목록 로드/렌더 ----------
let roomsCache = [];

async function loadRooms() {
  const { data, error } = await sb
    .from('rooms')
    .select('*, host:profiles!rooms_host_id_fkey(name, username), room_members(count)')
    .neq('status', 'closed')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    const list = document.getElementById('room-list');
    if (list) list.innerHTML = `<div class="empty">목록을 불러오지 못했습니다.</div>`;
    return;
  }
  roomsCache = data || [];
  paintRooms();
}

function memberCount(room) {
  return room.room_members?.[0]?.count ?? 0;
}

function paintRooms() {
  const list = document.getElementById('room-list');
  if (!list) return;
  const openCount = roomsCache.length;
  const statRooms = document.getElementById('stat-rooms');
  if (statRooms) statRooms.textContent = openCount;

  const rows = roomsCache.filter((r) => {
    if (!searchText) return true;
    return (
      (r.title || '').toLowerCase().includes(searchText) ||
      (r.location || '').toLowerCase().includes(searchText)
    );
  });

  if (!rows.length) {
    list.innerHTML = `<div class="empty">${openCount ? '검색 결과가 없어요.' : '아직 열린 방이 없어요. 첫 방을 만들어 보세요!'}</div>`;
    return;
  }

  list.innerHTML = rows
    .map((r) => {
      const cnt = memberCount(r);
      const full = cnt >= r.max_members;
      const gradeRange =
        r.grade_min || r.grade_max
          ? `${gradeLabel(r.grade_min || r.grade_max)}${r.grade_min && r.grade_max && r.grade_min !== r.grade_max ? `~${gradeLabel(r.grade_max)}` : ''}`
          : '';
      const statusBadge =
        r.status === 'playing' ? `<span class="badge playing">경기중</span>` : '';
      return `
        <button class="room-item${full ? ' full' : ''}" data-id="${r.id}">
          <div class="room-main">
            <div class="room-title">${esc(r.title)} ${statusBadge}</div>
            <div class="room-sub">
              ${r.location ? `<span>📍 ${esc(r.location)}</span>` : ''}
              ${r.play_at ? `<span>🕒 ${fmtDateTime(r.play_at)}</span>` : ''}
              ${gradeRange ? `<span>🏅 ${esc(gradeRange)}</span>` : ''}
            </div>
            <div class="room-host">방장 ${esc(r.host?.name || '알 수 없음')}</div>
          </div>
          <div class="room-count ${full ? 'is-full' : ''}">
            <span class="count-num">${cnt}/${r.max_members}</span>
            <span class="count-label">${full ? '마감' : '모집중'}</span>
          </div>
        </button>`;
    })
    .join('');

  list.querySelectorAll('.room-item').forEach((btn) => {
    btn.addEventListener('click', () => onJoin(btn.dataset.id));
  });
}

// ---------- 참여 ----------
async function onJoin(roomId) {
  const room = roomsCache.find((r) => r.id === roomId);
  const uid = store.session.user.id;
  const cnt = room ? memberCount(room) : 0;
  const isFull = room && cnt >= room.max_members;

  // 이미 방장/참여자면 그냥 입장. 아니면 정원 체크.
  const { error } = await sb.from('room_members').insert({ room_id: roomId, user_id: uid });
  if (error) {
    // 이미 참여 중(중복 PK)이면 그대로 입장
    if ((error.code === '23505') || (error.message || '').includes('duplicate')) {
      return go('room', { roomId });
    }
    if (isFull) return toast('정원이 가득 찼어요.', 'error');
    console.error(error);
    return toast('입장에 실패했습니다.', 'error');
  }
  go('room', { roomId });
}

// ---------- 방 생성 모달 ----------
function openCreateModal() {
  const gradeOpts = (sel) =>
    `<option value="">무관</option>` +
    GRADES.map((g) => `<option value="${g.code}"${g.code === sel ? ' selected' : ''}>${g.label}</option>`).join('');

  const modal = h('div', { class: 'modal-overlay' });
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>방 만들기</h3>
        <button class="icon-btn" id="m-close" aria-label="닫기">✕</button>
      </div>
      <form id="create-form" class="modal-body">
        <label class="field"><span>제목</span>
          <input name="title" placeholder="예) 오늘 저녁 복식 구합니다" required maxlength="40" />
        </label>
        <label class="field"><span>장소</span>
          <input name="location" placeholder="예) OO체육관 A코트" maxlength="40" />
        </label>
        <label class="field"><span>일시</span>
          <input name="play_at" type="datetime-local" />
        </label>
        <div class="field-row">
          <label class="field"><span>정원</span>
            <select name="max_members">
              <option value="2">2명</option>
              <option value="4" selected>4명</option>
              <option value="6">6명</option>
              <option value="8">8명</option>
            </select>
          </label>
          <label class="field"><span>급수 하한</span>
            <select name="grade_min">${gradeOpts('')}</select>
          </label>
          <label class="field"><span>급수 상한</span>
            <select name="grade_max">${gradeOpts('')}</select>
          </label>
        </div>
        <button type="submit" class="btn btn-primary">방 만들기</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  modal.querySelector('#m-close').addEventListener('click', close);
  modal.querySelector('#create-form').addEventListener('submit', (e) => onCreate(e, close));
}

async function onCreate(e, close) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const fd = new FormData(e.target);
  const title = String(fd.get('title') || '').trim();
  if (!title) return toast('제목을 입력하세요.', 'error');
  const location = String(fd.get('location') || '').trim() || null;
  const playRaw = String(fd.get('play_at') || '');
  const play_at = playRaw ? new Date(playRaw).toISOString() : null;
  const max_members = Number(fd.get('max_members')) || 4;
  const grade_min = String(fd.get('grade_min') || '') || null;
  const grade_max = String(fd.get('grade_max') || '') || null;

  btn.disabled = true;
  btn.textContent = '생성 중…';
  const { data, error } = await sb
    .from('rooms')
    .insert({
      title,
      location,
      play_at,
      max_members,
      grade_min,
      grade_max,
      host_id: store.session.user.id,
    })
    .select('id')
    .single();
  btn.disabled = false;
  btn.textContent = '방 만들기';
  if (error) {
    console.error(error);
    return toast('방 생성에 실패했습니다.', 'error');
  }
  close();
  toast('방을 만들었어요!', 'success');
  go('room', { roomId: data.id }); // 방장은 트리거로 자동 참여됨
}

// ---------- 설정 메뉴 ----------
function openSettings() {
  const sheet = h('div', { class: 'modal-overlay sheet' });
  sheet.innerHTML = `
    <div class="sheet-body">
      <button class="sheet-item" id="s-logout">로그아웃</button>
      <button class="sheet-item cancel" id="s-cancel">닫기</button>
    </div>
  `;
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  sheet.querySelector('#s-cancel').addEventListener('click', close);
  sheet.querySelector('#s-logout').addEventListener('click', async () => {
    close();
    clearChannels();
    await sb.auth.signOut(); // onAuthStateChange 가 로그인 화면으로 라우팅
  });
}

// ---------- 실시간 ----------
let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadRooms, 250); // 다발성 변경을 묶어서 1회 새로고침
}

function subscribeRealtime() {
  // 방/멤버 변경 → 목록 갱신
  const dbCh = sb
    .channel('lobby-db')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members' }, scheduleReload)
    .subscribe();

  // 접속자 수(프레즌스)
  const presCh = sb.channel('lobby-presence', {
    config: { presence: { key: store.session.user.id } },
  });
  presCh
    .on('presence', { event: 'sync' }, () => {
      const count = Object.keys(presCh.presenceState()).length;
      const el = document.getElementById('stat-online');
      if (el) el.textContent = count;
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presCh.track({ name: store.profile.name, at: Date.now() });
      }
    });

  store.channels.push(dbCh, presCh);
}
