'use strict';
/*
 * 배드민턴 웹앱 서버 (정적 서버 + 환경변수 주입)
 * - DB/인증/실시간은 전부 클라이언트 → Supabase 직결(RLS 보호)이라
 *   서버에는 DB 로직이 없다. 이 서버의 역할은 3가지:
 *     1) public/ 정적 파일 서빙
 *     2) GET /env.js  → 클라이언트에 공개 환경변수(SUPABASE_URL, ANON_KEY) 주입
 *     3) GET /healthz → UptimeRobot 가동 모니터(무료 티어 슬립 방지)
 * - 로컬:  node --env-file=.env server.js   (npm run dev)  또는 start.bat
 * - Render: 대시보드 Environment 에 SUPABASE_URL / SUPABASE_ANON_KEY 등록
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('\n  ⚠️  SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없습니다.');
  console.warn('     로컬:  node --env-file=.env server.js   (또는 start.bat)');
  console.warn('     Render: 대시보드 Environment 에 두 값을 등록하세요.');
  console.warn('     (없으면 프론트에서 Supabase 접속이 실패합니다.)\n');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// anon key 는 공개용(RLS 로 보호)이라 클라이언트 노출이 안전하다.
function serveEnv(res) {
  const body =
    'window.__ENV = ' +
    JSON.stringify({ SUPABASE_URL, SUPABASE_ANON_KEY }) +
    ';';
  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, url) {
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('ok');
  }
  if (url.pathname === '/env.js') {
    return serveEnv(res);
  }
  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log('\n  🏸 배드민턴 웹앱 서버 실행 중');
  console.log('  ────────────────────────────────');
  console.log(`  포트:     ${PORT}`);
  console.log(`  Supabase: ${SUPABASE_URL ? SUPABASE_URL : '(미설정)'}`);
  console.log(`  헬스체크: /healthz\n`);
});
