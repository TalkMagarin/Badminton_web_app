// 로비: 프로필 카드 + 메뉴 카드(모임 찾기 / 가입한 모임)
// 하위 페이지: renderFind(모임 찾기+만들기), renderMyRooms(가입한 모임)
import { sb } from './supabase.js';
import { store, go, clearChannels } from './app.js';
import { GRADES, expText, gradeSummary, gradeLabel, esc, initials, toast, h } from './util.js';
import { dropdown } from './components.js';

// ============================================================
//  로비 홈
// ============================================================
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

      <section class="menu-list">
        <button class="menu-card" id="card-find">
          <div class="menu-ic">🔍</div>
          <div class="menu-tx">
            <div class="menu-title">모임 찾기</div>
            <div class="menu-sub">모임을 검색하거나 새로 만들기</div>
          </div>
          <div class="menu-arrow">›</div>
        </button>
        <button class="menu-card" id="card-my">
          <div class="menu-ic">📋</div>
          <div class="menu-tx">
            <div class="menu-title">가입한 모임</div>
            <div class="menu-sub">내가 만들거나 가입한 모임</div>
          </div>
          <div class="menu-arrow">›</div>
        </button>
      </section>

      <!-- 게임/대진표 표시 영역 (이후 작업) -->
    </main>
  `;

  root.querySelector('#btn-noti').addEventListener('click', () => toast('알림 기능은 준비 중이에요.', 'info'));
  root.querySelector('#btn-settings').addEventListener('click', openProfileSettings);
  root.querySelector('#card-find').addEventListener('click', () => go('find'));
  root.querySelector('#card-my').addEventListener('click', () => go('myrooms'));
}

// ============================================================
//  모임 찾기 페이지 (검색 + 만들기)
// ============================================================
let searchText = '';
let roomsCache = [];

export function renderFind(root) {
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="btn-back" aria-label="뒤로">←</button>
      <div class="app-name">모임 찾기</div>
      <div class="top-actions">
        <button class="icon-btn" id="btn-create-top" title="모임 만들기" aria-label="모임 만들기">＋</button>
      </div>
    </header>
    <main class="lobby">
      <button class="btn btn-primary" id="btn-create">＋ 모임 만들기</button>
      <section class="rooms-section">
        <div class="section-head">
          <input class="search wide" id="room-search" placeholder="모임명 검색 (비공개는 전체 입력)" />
        </div>
        <div class="room-list" id="room-list"><div class="empty">불러오는 중…</div></div>
      </section>
    </main>
  `;
  root.querySelector('#btn-back').addEventListener('click', () => go('lobby'));
  root.querySelector('#btn-create').addEventListener('click', openCreateModal);
  root.querySelector('#btn-create-top').addEventListener('click', openCreateModal);
  const search = root.querySelector('#room-search');
  search.value = searchText;
  search.addEventListener('input', () => {
    searchText = search.value.trim().toLowerCase();
    paintRooms();
  });
  loadRooms();
  subscribeList('find-db', loadRooms);
}

async function loadRooms() {
  const { data, error } = await sb
    .from('rooms')
    .select('*, host:profiles!rooms_host_id_fkey(name, username), room_members(count)')
    .neq('status', 'closed')
    .order('created_at', { ascending: false });
  const list = document.getElementById('room-list');
  if (error) {
    console.error(error);
    if (list) list.innerHTML = `<div class="empty">목록을 불러오지 못했습니다.</div>`;
    return;
  }
  roomsCache = data || [];
  paintRooms();
}

function memberCount(room) {
  return room.room_members?.[0]?.count ?? 0;
}

function roomItemHTML(r, extraBadge = '') {
  const cnt = memberCount(r);
  const full = cnt >= r.max_members;
  const gradeRange =
    r.grade_min || r.grade_max
      ? `${gradeLabel(r.grade_min || r.grade_max)}${r.grade_min && r.grade_max && r.grade_min !== r.grade_max ? `~${gradeLabel(r.grade_max)}` : ''}`
      : '';
  const badges =
    (r.status === 'playing' ? `<span class="badge playing">경기중</span>` : '') +
    (r.is_private ? `<span class="badge private">비공개</span>` : '') +
    extraBadge;
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
}

function paintRooms() {
  const list = document.getElementById('room-list');
  if (!list) return;
  const myId = store.session?.user?.id;

  const rows = roomsCache.filter((r) => {
    const t = (r.title || '').toLowerCase();
    const mine = r.host_id === myId;
    if (!searchText) return !r.is_private || mine;       // 기본: 공개 + 내 비공개
    if (r.is_private) return mine || t === searchText;   // 비공개: 내 것 or 모임명 전체 일치
    return t.includes(searchText);                       // 공개: 부분 일치
  });

  if (!rows.length) {
    list.innerHTML = `<div class="empty">${searchText ? '검색 결과가 없어요.' : '아직 열린 모임이 없어요. 첫 모임을 만들어 보세요!'}</div>`;
    return;
  }
  list.innerHTML = rows.map((r) => roomItemHTML(r)).join('');
  list.querySelectorAll('.room-item').forEach((btn) => {
    btn.addEventListener('click', () => onJoin(btn.dataset.id));
  });
}

// ============================================================
//  가입한 모임 페이지
// ============================================================
export function renderMyRooms(root) {
  root.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" id="btn-back" aria-label="뒤로">←</button>
      <div class="app-name">가입한 모임</div>
      <div class="top-actions"></div>
    </header>
    <main class="lobby">
      <section class="rooms-section">
        <div class="room-list" id="my-room-list"><div class="empty">불러오는 중…</div></div>
      </section>
    </main>
  `;
  root.querySelector('#btn-back').addEventListener('click', () => go('lobby'));
  loadMyRooms();
  subscribeList('my-db', loadMyRooms);
}

const ROLE_BADGE = {
  owner: '<span class="badge host">모임장</span>',
  staff: '<span class="badge staff">운영진</span>',
  member: '',
};

async function loadMyRooms() {
  const uid = store.session.user.id;
  const list = document.getElementById('my-room-list');
  const { data: mems, error } = await sb
    .from('room_members')
    .select('role, room_id')
    .eq('user_id', uid)
    .eq('status', 'approved');
  if (error) {
    console.error(error);
    if (list) list.innerHTML = `<div class="empty">목록을 불러오지 못했습니다.</div>`;
    return;
  }
  const roleMap = {};
  (mems || []).forEach((m) => (roleMap[m.room_id] = m.role));
  const ids = Object.keys(roleMap);
  if (!ids.length) {
    if (list) list.innerHTML = `<div class="empty">아직 가입한 모임이 없어요.<br>모임 찾기에서 참여해 보세요!</div>`;
    return;
  }
  const { data: rooms } = await sb
    .from('rooms')
    .select('*, host:profiles!rooms_host_id_fkey(name), room_members(count)')
    .in('id', ids)
    .order('created_at', { ascending: false });
  if (!list) return;
  list.innerHTML = (rooms || [])
    .map((r) => roomItemHTML(r, ROLE_BADGE[roleMap[r.id]] || ''))
    .join('');
  // 이미 참여자이므로 바로 입장
  list.querySelectorAll('.room-item').forEach((btn) => {
    btn.addEventListener('click', () => go('room', { roomId: btn.dataset.id }));
  });
}

// ============================================================
//  참여 / 비공개 암호
// ============================================================
async function onJoin(roomId) {
  const room = roomsCache.find((r) => r.id === roomId);
  const uid = store.session.user.id;
  if (room && room.is_private && room.host_id !== uid) return openPasswordPrompt(room);
  go('room', { roomId });
}

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
    const { data, error } = await sb.rpc('join_room_with_password', { p_room_id: room.id, p_password: pw });
    btn.disabled = false;
    btn.textContent = '입장하기';
    if (error) { console.error(error); return toast('입장에 실패했습니다.', 'error'); }
    if (data === true) { close(); go('room', { roomId: room.id }); }
    else toast('암호가 올바르지 않아요.', 'error');
  });
  setTimeout(() => modal.querySelector('input[name=pw]')?.focus(), 50);
}

// ============================================================
//  모임 만들기
// ============================================================
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
        <label class="field"><span>정원 (명, 최대 500)</span>
          <input name="max_members" type="number" inputmode="numeric" min="2" max="500" value="4" required />
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
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#m-close').addEventListener('click', close);

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
      ? '모임 찾기에선 숨겨지고, 모임명 전체 검색 시 나와요. 암호로 입장해요.'
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
  const max_members = Math.max(2, Math.min(500, Number(fd.get('max_members')) || 4));
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
    .insert({ title, max_members, is_private, grade_min, grade_max, host_id: store.session.user.id })
    .select('id')
    .single();
  if (error) {
    btn.disabled = false;
    btn.textContent = '모임 만들기';
    console.error(error);
    return toast('모임 생성에 실패했습니다.', 'error');
  }

  if (is_private) {
    const { error: pwErr } = await sb.rpc('set_room_password', { p_room_id: data.id, p_password: password });
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
  go('room', { roomId: data.id });
}

// ============================================================
//  내 정보 설정 (사진 / 구력 / 급수 / 로그아웃)
// ============================================================
function openProfileSettings() {
  const p = store.profile;
  const modal = h('div', { class: 'modal-overlay' });
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>내 정보 설정</h3>
        <button class="icon-btn" id="ps-close" aria-label="닫기">✕</button>
      </div>
      <div class="modal-body">
        <div class="field"><span>프로필 사진</span>
          <div class="avatar-edit">
            <div class="avatar" id="ps-avatar">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(initials(p.name))}</div>
            <label class="btn btn-outline compact"><span id="ps-file-tx">사진 등록</span>
              <input type="file" accept="image/*" id="ps-file" hidden />
            </label>
          </div>
        </div>
        <div class="field"><span>구력 (운동 시작 년·월)</span>
          <div class="field-row" id="ps-exp"></div>
        </div>
        <div class="field-row">
          <div class="field"><span>지역 급수</span><div id="ps-region"></div></div>
          <div class="field"><span>전국 급수</span><div id="ps-national"></div></div>
        </div>
        <button class="btn btn-primary" id="ps-save">저장</button>
        <button class="btn btn-outline" id="ps-logout" style="margin-top:10px">로그아웃</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('#ps-close').addEventListener('click', close);

  // 드롭다운 옵션
  const nowY = new Date().getFullYear();
  const nowM = new Date().getMonth() + 1;
  const yearOpts = [];
  for (let y = nowY; y >= nowY - 40; y--) yearOpts.push({ value: String(y), label: `${y}년` });
  const monthOpts = [];
  for (let m = 1; m <= 12; m++) monthOpts.push({ value: String(m), label: `${m}월` });
  const gradeOpts = [{ value: '', label: '(없음)' }].concat(
    GRADES.map((g) => ({ value: g.code, label: `${g.label}${g.sub ? ` (${g.sub})` : ''}` }))
  );

  // 현재 값 프리필
  const [sy, smRaw] = String(p.exp_start || '').split('-');
  const sm = smRaw ? String(Number(smRaw)) : '';
  const yearDd = dropdown({ options: yearOpts, value: sy || '', placeholder: '년도', ariaLabel: '구력 년도' });
  const monthDd = dropdown({ options: monthOpts, value: sm, placeholder: '월', ariaLabel: '구력 월' });
  const regionDd = dropdown({ options: gradeOpts, value: p.grade_region || '', ariaLabel: '지역 급수' });
  const nationalDd = dropdown({ options: gradeOpts, value: p.grade_national || '', ariaLabel: '전국 급수' });
  modal.querySelector('#ps-exp').append(yearDd.el, monthDd.el);
  modal.querySelector('#ps-region').append(regionDd.el);
  modal.querySelector('#ps-national').append(nationalDd.el);

  // 사진 업로드
  const fileInput = modal.querySelector('#ps-file');
  const fileTx = modal.querySelector('#ps-file-tx');
  const avatarEl = modal.querySelector('#ps-avatar');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('이미지 파일만 등록할 수 있어요.', 'error');
    if (file.size > 2 * 1024 * 1024) return toast('2MB 이하 이미지만 등록할 수 있어요.', 'error');
    const uid = store.session.user.id;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${uid}/${Date.now()}.${ext}`;
    fileTx.textContent = '업로드 중…';
    const up = await sb.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) { console.error(up.error); fileTx.textContent = '사진 등록'; return toast('업로드 실패: ' + up.error.message, 'error'); }
    const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', uid);
    if (error) { console.error(error); fileTx.textContent = '사진 등록'; return toast('저장에 실패했습니다.', 'error'); }
    store.profile.avatar_url = url;
    avatarEl.innerHTML = `<img src="${esc(url)}" alt="">`;
    fileTx.textContent = '사진 변경';
    toast('사진을 등록했어요.', 'success');
  });

  // 저장 (구력/급수)
  modal.querySelector('#ps-save').addEventListener('click', async () => {
    const y = yearDd.get();
    const m = monthDd.get();
    if (!y || !m) return toast('구력(운동 시작 년·월)을 선택하세요.', 'error');
    if (new Date(Number(y), Number(m) - 1, 1) > new Date(nowY, nowM - 1, 1))
      return toast('구력은 미래로 설정할 수 없어요.', 'error');
    const exp_start = `${y}-${String(m).padStart(2, '0')}-01`;
    const grade_region = regionDd.get() || null;
    const grade_national = nationalDd.get() || null;
    const btn = modal.querySelector('#ps-save');
    btn.disabled = true;
    btn.textContent = '저장 중…';
    const { error } = await sb.from('profiles').update({ exp_start, grade_region, grade_national }).eq('id', store.session.user.id);
    btn.disabled = false;
    btn.textContent = '저장';
    if (error) { console.error(error); return toast('저장에 실패했습니다.', 'error'); }
    Object.assign(store.profile, { exp_start, grade_region, grade_national });
    close();
    toast('저장했어요.', 'success');
    renderLobby(document.getElementById('app')); // 프로필 카드 갱신
  });

  // 로그아웃
  modal.querySelector('#ps-logout').addEventListener('click', async () => {
    close();
    clearChannels();
    await sb.auth.signOut();
  });
}

// ============================================================
//  실시간 (목록 페이지 공용)
// ============================================================
let reloadTimer = null;
function subscribeList(channelName, loader) {
  const ch = sb
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(loader, 250);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members' }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(loader, 250);
    })
    .subscribe();
  store.channels.push(ch);
}
