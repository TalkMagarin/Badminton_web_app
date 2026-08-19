// 앱 진입점: 세션 감지 → 화면 라우팅(auth ↔ lobby ↔ room)
import { sb, CONFIG_OK } from './supabase.js';
import { renderAuth } from './auth.js';
import { renderLobby, renderFind, renderMyRooms } from './lobby.js';
import { renderRoom } from './room.js';
import { toast } from './util.js';

const root = document.getElementById('app');

// 앱 전역 상태
export const store = {
  session: null,
  profile: null, // { id, username, name, exp_start, grade, grade_scope, avatar_url }
  suppressRoute: false, // 회원가입 중 자동 라우팅(→로그아웃) 방지
  channels: [], // 활성 Realtime 채널 (화면 전환 시 정리)
};

// 화면을 떠날 때 실시간 채널 해제 (구독 누수 방지)
export function clearChannels() {
  for (const ch of store.channels) {
    try {
      sb.removeChannel(ch);
    } catch (_) {}
  }
  store.channels = [];
}

export function el() {
  return root;
}

// 화면 전환 (모듈들이 호출)
export function go(screen, params = {}) {
  clearChannels();
  root.innerHTML = '';
  if (screen === 'auth') renderAuth(root);
  else if (screen === 'lobby') renderLobby(root);
  else if (screen === 'find') renderFind(root);
  else if (screen === 'myrooms') renderMyRooms(root);
  else if (screen === 'room') renderRoom(root, params.roomId);
}

// 로그인 유저의 프로필 로드
export async function loadProfile() {
  const uid = store.session?.user?.id;
  if (!uid) {
    store.profile = null;
    return null;
  }
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) {
    console.error('프로필 조회 오류', error);
    return null;
  }
  store.profile = data;
  return data;
}

export async function routeBySession() {
  if (!store.session) {
    go('auth');
    return;
  }
  await loadProfile();
  if (!store.profile) {
    // 인증은 됐지만 프로필 row 가 없는 예외 상황 → 로그아웃 후 재가입 유도
    toast('프로필 정보가 없습니다. 다시 가입해 주세요.', 'error');
    await sb.auth.signOut();
    return;
  }
  go('lobby');
}

async function boot() {
  if (!CONFIG_OK) {
    root.innerHTML =
      '<div class="config-error">' +
      '<h2>설정 필요</h2>' +
      '<p>서버에 <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> 환경변수가 설정되지 않았습니다.</p>' +
      '<p><code>.env</code> 파일(로컬) 또는 Render Environment 를 확인하세요.</p>' +
      '</div>';
    return;
  }

  const { data } = await sb.auth.getSession();
  store.session = data.session;

  // 인증 상태 변화 → 자동 라우팅
  sb.auth.onAuthStateChange((_event, session) => {
    store.session = session;
    if (store.suppressRoute) return; // 회원가입 중이면 해당 핸들러가 직접 라우팅
    routeBySession();
  });

  await routeBySession();
}

boot();
