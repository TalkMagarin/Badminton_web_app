// 로비 화면: 상단바 + 프로필 카드 + 방 생성/찾기/현황(실시간)
import { sb } from './supabase.js';
import { store, go, clearChannels } from './app.js';
import {
  GRADES, expText, gradeSummary, gradeLabel, esc, initials, toast, h,
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
          <div class="stat-label">열린 모임</div>
        </div>
        <button class="stat stat-cta" id="btn-create">
          <div class="stat-num">＋</div>
          <div class="stat-label">모임 만들기</div>
        </button>
      </section>

      <section class="rooms-section">
        <div class="section-head">
          <h2>모임 찾기</h2>
          <input class="search" id="room-search" placeholder="모임명 검색" />
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
  const myId = store.session?.user?.id;
  const openCount = roomsCache.length;
  const statRooms = document.getElementById('stat-rooms');
  if (statRooms) statRooms.textContent = openCount;

  const rows = roomsCache.filter((r) => {
    const matches = (r.title || '').toLowerCase().includes(searchText);
    // 검색어가 없으면: 공개 모임 + 내가 만든 비공개 모임만
    if (!searchText) return !r.is_private || r.host_id === myId;
    // 검색 중이면: 이름이 일치하면 비공개도 노출(암호로 입장)
    return matches;
  });

  if (!rows.length) {
    list.innerHTML = `<div class="empty">${openCount ? '검색 결과가 없어요.' : '아직 열린 모임이 없어요. 첫 모임을 만들어 보세요!'}</div>`;
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
      const badges =
        (r.status === 'playing' ? `<span class="badge playing">경기중</span>` : '') +
        (r.is_private ? `<span class="badge private">비공개</span>` : '');
      const sub = gradeRange ? `<div class="room-sub"><span>🏅 ${esc(gradeRange)}</span></div>` : '';
      return `
        <button class="room-item${full ? ' full' : ''}" data-id="${r.id}">
          <div class="room-main">
            <div class="room-title">${esc(r.title)} ${badges}</div>
            ${sub}
            <div class="room-host">모임장 ${esc(r.host?.name || '알 수 없음')}</div>
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
// 목록에서 모임을 누르면 방 화면으로 진입(가입은 방 안에서 '가입요청' → 승인).
// 비공개 모임(내가 방장이 아님)은 암호 입력 후 입장.
async function onJoin(roomId) {
  const room = roomsCache.find((r) => r.id === roomId);
  const uid = store.session.user.id;
  if (room && room.is_private && room.host_id !== uid) return openPasswordPrompt(room);
  go('room', { roomId });
}

// 비공개 모임 암호 입력 모달
function openPasswordPrompt(room) {
  const modal = h('div', { class: 'modal-overlay' });
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>🔒 ${esc(room.title)}</h3>
        <button class="icon-btn" id="p-close" aria-label="닫기">✕</button>
      </div>
      <form id="pw-form" class="modal-body">
        <label class="field"><span>모임 암호</span>
          <input name="pw" type="password" placeholder="암호를 입력하세요" autocomplete="off" required />
        </label>
        <button type="submit" class="btn btn-primary">입장하기</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#p-close').addEventListener('click', close);
  modal.querySelector('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const pw = String(new FormData(e.target).get('pw') || '');
    if (!pw) return toast('암호를 입력하세요.', 'error');
    btn.disabled = true;
    btn.textContent = '확인 중…';
    const { data, error } = await sb.rpc('join_room_with_password', {
      p_room_id: room.id,
      p_password: pw,
    });
    btn.disabled = false;
    btn.textContent = '입장하기';
    if (error) {
      console.error(error);
      return toast('입장에 실패했습니다.', 'error');
    }
    if (data === true) {
      close();
      go('room', { roomId: room.id });
    } else {
      toast('암호가 올바르지 않아요.', 'error');
    }
  });
  setTimeout(() => modal.querySelector('input[name=pw]')?.focus(), 50);
}

// ---------- 모임 생성 모달 ----------
function openCreateModal() {
  const gradeOpts = () =>
    `<option value="">무관</option>` +
    GRADES.map((g) => `<option value="${g.code}">${g.label}</option>`).join('');

  const modal = h('div', { class: 'modal-overlay' });
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>모임 만들기</h3>
        <button class="icon-btn" id="m-close" aria-label="닫기">✕</button>
      </div>
      <form id="create-form" class="modal-body">
        <label class="field"><span>모임명</span>
          <input name="title" placeholder="예) 오늘 저녁 복식 모임" required maxlength="40" />
        </label>
        <div class="field-row">
          <label class="field"><span>급수 하한</span>
            <select name="grade_min">${gradeOpts()}</select>
          </label>
          <label class="field"><span>급수 상한</span>
            <select name="grade_max">${gradeOpts()}</select>
          </label>
        </div>
        <label class="field"><span>정원 (명)</span>
          <input name="max_members" type="number" inputmode="numeric" min="2" max="99" value="4" required />
        </label>
        <div class="field"><span>공개 설정</span>
          <div class="segmented" id="seg-visibility">
            <button type="button" class="seg-btn active" data-v="false">공개</button>
            <button type="button" class="seg-btn" data-v="true">비공개</button>
          </div>
          <input type="hidden" name="is_private" value="false" />
          <small class="hint" id="vis-hint">누구나 모임 찾기에서 볼 수 있어요</small>
        </div>
        <label class="field" id="pw-field" style="display:none"><span>모임 암호</span>
          <input name="room_password" type="password" placeholder="4자 이상" autocomplete="off" maxlength="30" />
        </label>
        <button type="submit" class="btn btn-primary">모임 만들기</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  modal.querySelector('#m-close').addEventListener('click', close);

  // 공개/비공개 세그먼트
  const seg = modal.querySelector('#seg-visibility');
  const hidden = modal.querySelector('input[name=is_private]');
  const visHint = modal.querySelector('#vis-hint');
  const pwField = modal.querySelector('#pw-field');
  const pwInput = modal.querySelector('input[name=room_password]');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    const priv = b.dataset.v === 'true';
    hidden.value = b.dataset.v;
    visHint.textContent = priv
      ? '모임 찾기에선 숨겨지고, 검색 시 나와요. 암호로 입장해요.'
      : '누구나 모임 찾기에서 볼 수 있어요';
    pwField.style.display = priv ? '' : 'none';
    if (!priv) pwInput.value = '';
  });

  modal.querySelector('#create-form').addEventListener('submit', (e) => onCreate(e, close));
}

async function onCreate(e, close) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const fd = new FormData(e.target);
  const title = String(fd.get('title') || '').trim();
  if (!title) return toast('모임명을 입력하세요.', 'error');
  const max_members = Math.max(2, Math.min(99, Number(fd.get('max_members')) || 4));
  const is_private = fd.get('is_private') === 'true';
  const password = String(fd.get('room_password') || '');
  const grade_min = String(fd.get('grade_min') || '') || null;
  const grade_max = String(fd.get('grade_max') || '') || null;

  if (is_private && password.length < 4)
    return toast('비공개 모임은 암호(4자 이상)를 설정하세요.', 'error');

  btn.disabled = true;
  btn.textContent = '생성 중…';
  const { data, error } = await sb
    .from('rooms')
    .insert({
      title,
      max_members,
      is_private,
      grade_min,
      grade_max,
      host_id: store.session.user.id,
    })
    .select('id')
    .single();
  if (error) {
    btn.disabled = false;
    btn.textContent = '모임 만들기';
    console.error(error);
    return toast('모임 생성에 실패했습니다.', 'error');
  }

  // 비공개면 암호 설정. 실패 시 유령 모임 방지 위해 롤백(삭제).
  if (is_private) {
    const { error: pwErr } = await sb.rpc('set_room_password', {
      p_room_id: data.id,
      p_password: password,
    });
    if (pwErr) {
      console.error(pwErr);
      await sb.from('rooms').delete().eq('id', data.id);
      btn.disabled = false;
      btn.textContent = '모임 만들기';
      return toast('암호 설정에 실패했습니다. 다시 시도해 주세요.', 'error');
    }
  }

  btn.disabled = false;
  btn.textContent = '모임 만들기';
  close();
  toast('모임을 만들었어요!', 'success');
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
