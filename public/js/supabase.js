// Supabase 클라이언트 초기화 (Auth · Realtime · RLS DB)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const env = window.__ENV || {};

export const CONFIG_OK = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

// 아이디 → 가상 이메일 매핑 (Supabase Auth 는 이메일 기반)
export const EMAIL_DOMAIN = 'badminton.local';
export const usernameToEmail = (u) => `${String(u).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export const sb = CONFIG_OK
  ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
