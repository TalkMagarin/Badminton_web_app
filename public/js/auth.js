// 인증 화면: 로그인 / 회원가입(아이디·비밀번호·이름·구력·급수)
import { sb, usernameToEmail } from './supabase.js';
import { store, loadProfile, go } from './app.js';
import { GRADES, expText, toast } from './util.js';
import { dropdown } from './components.js';

let mode = 'login'; // 'login' | 'signup'

export function renderAuth(root) {
  root.innerHTML = '';
  root.appendChild(mode === 'login' ? loginView() : signupView());
}

function switchMode(root, next) {
  mode = next;
  renderAuth(root);
}

// ---------- 로그인 ----------
function loginView() {
  const wrap = document.createElement('div');
  wrap.className = 'auth-screen';
  wrap.innerHTML = `
    <div class="brand">
      <div class="brand-logo">🏸</div>
      <h1>라켓로비</h1>
      <p class="brand-sub">배드민턴 동호인 로비</p>
    </div>
    <form class="card auth-card" id="login-form" novalidate>
      <label class="field">
        <span>아이디</span>
        <input name="username" autocomplete="username" placeholder="아이디" required />
      </label>
      <label class="field">
        <span>비밀번호</span>
        <input name="password" type="password" autocomplete="current-password" placeholder="비밀번호" required />
      </label>
      <button type="submit" class="btn btn-primary">로그인</button>
    </form>
    <p class="switch">아직 회원이 아니신가요? <a href="#" id="to-signup">회원가입</a></p>
  `;
  const root = document.getElementById('app');
  wrap.querySelector('#to-signup').addEventListener('click', (e) => {
    e.preventDefault();
    switchMode(root, 'signup');
  });
  wrap.querySelector('#login-form').addEventListener('submit', onLogin);
  return wrap;
}

async function onLogin(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const fd = new FormData(e.target);
  const username = String(fd.get('username') || '').trim();
  const password = String(fd.get('password') || '');
  if (!username || !password) return toast('아이디와 비밀번호를 입력하세요.', 'error');

  btn.disabled = true;
  btn.textContent = '로그인 중…';
  const { error } = await sb.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  btn.disabled = false;
  btn.textContent = '로그인';
  if (error) {
    toast('아이디 또는 비밀번호가 올바르지 않습니다.', 'error');
    return;
  }
  // 성공 시 onAuthStateChange 가 로비로 라우팅
}

// ---------- 회원가입 ----------
function signupView() {
  const wrap = document.createElement('div');
  wrap.className = 'auth-screen';

  // 급수 옵션 (없음 포함) — 커스텀 드롭다운용
  const gradeOpts = [{ value: '', label: '(없음)' }].concat(
    GRADES.map((g) => ({ value: g.code, label: `${g.label}${g.sub ? ` (${g.sub})` : ''}` }))
  );

  // 구력: 년/월 옵션 (오늘 기준 과거 40년 ~ 현재)
  const nowY = new Date().getFullYear();
  const nowM = new Date().getMonth() + 1;
  const yearOpts = [];
  for (let y = nowY; y >= nowY - 40; y--) yearOpts.push({ value: String(y), label: `${y}년` });
  const monthOpts = [];
  for (let m = 1; m <= 12; m++) monthOpts.push({ value: String(m), label: `${m}월` });

  wrap.innerHTML = `
    <div class="brand small">
      <div class="brand-logo">🏸</div>
      <h1>회원가입</h1>
    </div>
    <form class="card auth-card" id="signup-form" novalidate>
      <label class="field">
        <span>아이디</span>
        <input name="username" autocomplete="username" placeholder="영문/숫자 아이디" required />
      </label>
      <label class="field">
        <span>비밀번호</span>
        <input name="password" type="password" autocomplete="new-password" placeholder="6자 이상" required />
      </label>
      <label class="field">
        <span>이름</span>
        <input name="name" placeholder="이름" required />
      </label>
      <div class="field">
        <span>성별</span>
        <div class="segmented" id="seg-gender">
          <button type="button" class="seg-btn" data-v="male">남자</button>
          <button type="button" class="seg-btn" data-v="female">여자</button>
        </div>
        <input type="hidden" name="gender" value="" />
      </div>
      <div class="field">
        <span>구력 (운동 시작 년·월)</span>
        <div class="field-row" id="exp-mount"></div>
        <small class="hint" id="exp-hint">운동 시작 년·월을 선택하세요</small>
      </div>
      <div class="field-row">
        <div class="field">
          <span>지역 급수</span>
          <div id="region-mount"></div>
        </div>
        <div class="field">
          <span>전국 급수</span>
          <div id="national-mount"></div>
        </div>
      </div>
      <button type="submit" class="btn btn-primary">가입하기</button>
    </form>
    <p class="switch">이미 계정이 있으신가요? <a href="#" id="to-login">로그인</a></p>
  `;

  const root = document.getElementById('app');
  wrap.querySelector('#to-login').addEventListener('click', (e) => {
    e.preventDefault();
    switchMode(root, 'login');
  });

  // ---- 커스텀 드롭다운 장착 ----
  const expHint = wrap.querySelector('#exp-hint');
  const updateExp = () => {
    const y = yearDd.get();
    const m = monthDd.get();
    if (!y || !m) {
      expHint.textContent = '운동 시작 년·월을 선택하세요';
      expHint.classList.remove('err');
      return;
    }
    const sel = new Date(Number(y), Number(m) - 1, 1);
    if (sel > new Date(nowY, nowM - 1, 1)) {
      expHint.textContent = '미래는 선택할 수 없어요';
      expHint.classList.add('err');
      return;
    }
    expHint.classList.remove('err');
    expHint.textContent = `구력 ${expText(`${y}-${String(m).padStart(2, '0')}-01`)}`;
  };

  const yearDd = dropdown({ options: yearOpts, placeholder: '년도', ariaLabel: '구력 년도', onChange: updateExp });
  const monthDd = dropdown({ options: monthOpts, placeholder: '월', ariaLabel: '구력 월', onChange: updateExp });
  const regionDd = dropdown({ options: gradeOpts, value: '', ariaLabel: '지역 급수' });
  const nationalDd = dropdown({ options: gradeOpts, value: '', ariaLabel: '전국 급수' });

  wrap.querySelector('#exp-mount').append(yearDd.el, monthDd.el);
  wrap.querySelector('#region-mount').append(regionDd.el);
  wrap.querySelector('#national-mount').append(nationalDd.el);

  // 성별 세그먼트
  const genderSeg = wrap.querySelector('#seg-gender');
  const genderInput = wrap.querySelector('input[name=gender]');
  genderSeg.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    genderSeg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    genderInput.value = b.dataset.v;
  });

  wrap.querySelector('#signup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const fd = new FormData(e.target);
    const username = String(fd.get('username') || '').trim();
    const password = String(fd.get('password') || '');
    const name = String(fd.get('name') || '').trim();
    const gender = String(fd.get('gender') || '');
    const y = yearDd.get();
    const m = monthDd.get();

    // 검증
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
      return toast('아이디는 영문/숫자 3~20자로 입력하세요.', 'error');
    if (password.length < 6) return toast('비밀번호는 6자 이상이어야 합니다.', 'error');
    if (!name) return toast('이름을 입력하세요.', 'error');
    if (gender !== 'male' && gender !== 'female') return toast('성별을 선택하세요.', 'error');
    if (!y || !m) return toast('구력(운동 시작 년·월)을 선택하세요.', 'error');
    if (new Date(Number(y), Number(m) - 1, 1) > new Date(nowY, nowM - 1, 1))
      return toast('구력은 미래로 설정할 수 없어요.', 'error');

    submitSignup(
      {
        username,
        password,
        name,
        gender,
        expStart: `${y}-${String(m).padStart(2, '0')}-01`,
        gradeRegion: regionDd.get() || null, // 없음 → null
        gradeNational: nationalDd.get() || null,
      },
      btn
    );
  });

  return wrap;
}

// 실제 가입 처리 (검증은 호출부에서 완료)
async function submitSignup({ username, password, name, gender, expStart, gradeRegion, gradeNational }, btn) {
  btn.disabled = true;
  btn.textContent = '가입 중…';
  store.suppressRoute = true; // 프로필 insert 전 자동 라우팅 방지
  try {
    const { data, error } = await sb.auth.signUp({
      email: usernameToEmail(username),
      password,
    });
    if (error) {
      if ((error.message || '').toLowerCase().includes('already'))
        toast('이미 사용 중인 아이디입니다.', 'error');
      else toast('가입 실패: ' + error.message, 'error');
      return;
    }
    const uid = data.user?.id;
    if (!data.session || !uid) {
      // 이메일 확인이 켜져 있으면 세션이 없다 → RLS 로 프로필 insert 불가
      toast('가입 확인 설정을 확인하세요. (Supabase: 이메일 확인 끄기)', 'error');
      return;
    }

    const { error: pErr } = await sb.from('profiles').insert({
      id: uid,
      username,
      name,
      gender,
      exp_start: expStart,
      grade_region: gradeRegion,
      grade_national: gradeNational,
    });
    if (pErr) {
      // 프로필 저장 실패 → 유령 계정 방지 위해 로그아웃
      console.error(pErr);
      if ((pErr.message || '').includes('duplicate')) toast('이미 사용 중인 아이디입니다.', 'error');
      else toast('프로필 저장 실패: ' + pErr.message, 'error');
      await sb.auth.signOut();
      return;
    }

    await loadProfile();
    toast('환영합니다! 가입이 완료됐어요.', 'success');
    go('lobby');
  } finally {
    store.suppressRoute = false;
    btn.disabled = false;
    btn.textContent = '가입하기';
  }
}
