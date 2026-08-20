// 페이지 공통: 세션 가드 + 페이지 이동(페이드)
import { sb } from './supabase.js';

// 로그인 필요 페이지에서 호출. 세션·프로필 반환, 없으면 로그인으로 이동.
export async function requireAuth() {
  const { data } = await sb.auth.getSession();
  if (!data.session) { location.replace('/'); return null; }
  const uid = data.session.user.id;
  const { data: profile, error } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error || !profile) { await sb.auth.signOut(); location.replace('/'); return null; }
  return { session: data.session, uid, profile };
}

// 이미 로그인된 경우 로비로(로그인/가입 페이지에서 사용)
export async function redirectIfAuthed() {
  const { data } = await sb.auth.getSession();
  if (data.session) { location.replace('/lobby.html'); return true; }
  return false;
}

// 페이드 아웃 후 이동
export function goPage(url) {
  document.body.classList.remove('page-fade-in');
  document.body.classList.add('page-fade-out');
  setTimeout(() => { location.href = url; }, 260);
}

// 뒤로가기(지정 경로로 페이드 이동)
export function goBack(url) { goPage(url); }
