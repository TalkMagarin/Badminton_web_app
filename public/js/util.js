// 공용 상수 · 순수 헬퍼 (순환 import 방지를 위해 여기 모음)

// ---------- 급수(조) 정의 ----------
export const GRADES = [
  { code: 'E', label: 'E조', sub: '초심' },
  { code: 'D', label: 'D조', sub: '' },
  { code: 'C', label: 'C조', sub: '' },
  { code: 'B', label: 'B조', sub: '' },
  { code: 'A', label: 'A조', sub: '' },
  { code: 'S', label: 'S조', sub: '자강·준자강' },
];

export function gradeLabel(code) {
  const g = GRADES.find((x) => x.code === code);
  return g ? g.label : (code || '');
}

// 지역·전국 급수를 함께 표기. 예: "지역 D조 · 전국 C조", 한쪽만 있으면 그쪽만, 둘 다 없으면 "급수 없음"
export function gradeSummary(region, national) {
  const parts = [];
  if (region) parts.push(`지역 ${gradeLabel(region)}`);
  if (national) parts.push(`전국 ${gradeLabel(national)}`);
  return parts.length ? parts.join(' · ') : '급수 없음';
}

// ---------- 구력 계산 ----------
// exp_start(YYYY-MM-01 형태 date 문자열) → 오늘까지 "N년 M개월"
export function expText(expStart) {
  if (!expStart) return '-';
  const s = new Date(expStart);
  if (isNaN(s)) return '-';
  const now = new Date();
  let months = (now.getFullYear() - s.getFullYear()) * 12 + (now.getMonth() - s.getMonth());
  if (months < 0) months = 0;
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y && m) return `${y}년 ${m}개월`;
  if (y) return `${y}년`;
  return `${m}개월`;
}

// <input type="month"> 값("YYYY-MM") → date 문자열("YYYY-MM-01")
export function monthToDate(ym) {
  if (!ym) return null;
  return `${ym}-01`;
}

// ---------- DOM/문자열 유틸 ----------
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function initials(name) {
  const n = String(name || '').trim();
  return n ? n.slice(0, 1) : '?';
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 토스트 ----------
let toastTimer = null;
export function toast(msg, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 2600);
}

// 간단한 엘리먼트 생성 헬퍼
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}
