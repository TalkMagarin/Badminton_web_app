# 🏸 라켓로비 — 배드민턴 동호인 웹앱

로그인/회원가입 후 로비에서 프로필(사진·이름·구력·급수)을 확인하고,
방을 만들고/찾고/현황을 **실시간**으로 보는 배드민턴 매칭 웹앱.

- **호스팅**: Render (Web Service)
- **DB · 인증 · 실시간**: Supabase (Postgres + Auth + Realtime)
- **모니터링**: UptimeRobot (`/healthz`)
- **프론트**: 빌드 없는 바닐라 JS(ES 모듈) + `@supabase/supabase-js`(ESM CDN)

DB 접근은 전부 **프론트 → Supabase 직결(RLS로 보호)**. 서버(`server.js`)는
정적 파일 서빙 + 환경변수 주입(`/env.js`) + 헬스체크(`/healthz`)만 담당한다.

---

## 1. Supabase 설정

1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성.
2. **SQL Editor** → `supabase_schema.sql` 전체를 붙여넣고 실행
   (테이블 · RLS 정책 · Realtime publication · 방장 자동참여 트리거 생성).
3. **Authentication → Sign In / Providers → Email** 에서
   **"Confirm email" 을 끈다**.
   (아이디를 가상 이메일 `아이디@badminton.local` 로 쓰기 때문에 실제 메일 확인이 불가.)
4. **Project Settings → API** 에서 다음 두 값을 복사:
   - `Project URL` → `SUPABASE_URL`
   - `anon` `public` key → `SUPABASE_ANON_KEY` (RLS로 보호되므로 공개해도 안전)

---

## 2. 로컬 실행

```bash
# 1) 환경변수 파일 준비
cp .env.example .env      # 윈도우: copy .env.example .env
# .env 에 SUPABASE_URL / SUPABASE_ANON_KEY 채우기

# 2) 실행 (의존성 없음, Node 18+)
npm run dev
# 또는 윈도우에서 start.bat 더블클릭
```

접속: <http://localhost:3000>

---

## 3. Render 배포

**방법 A — Blueprint(`render.yaml`)**: 대시보드 → New + → Blueprint → 이 저장소 선택.

**방법 B — 수동**: New + → Web Service → 저장소 연결 후
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `node server.js`
- Health Check Path: `/healthz`
- Environment: `SUPABASE_URL`, `SUPABASE_ANON_KEY` 등록

> Render 무료 티어는 15분 무요청 시 슬립 → 다음 요청이 느려진다.
> UptimeRobot 핑으로 깨어 있게 유지한다.

---

## 4. UptimeRobot 모니터링

1. New Monitor → Type **HTTP(s)**
2. URL: `https://<앱이름>.onrender.com/healthz`
3. Interval: 5분

---

## 5. 기능 개요

| 화면 | 내용 |
|------|------|
| 로그인 | 아이디 + 비밀번호 |
| 회원가입 | 아이디 / 비밀번호 / 이름 / 구력(운동 시작 년·월 → "N년 M개월") / 급수(지역·전국 각각 입력) |
| 로비 | 상단바(앱명 · 알림 · 설정), 프로필 카드, 접속중/열린방 현황, 방 찾기(실시간), 방 만들기 |
| 방 상세 | 참여자 실시간 목록, 나가기 / 방장 종료 |

### 급수(조)
`E조(초심)` · `D조` · `C조` · `B조` · `A조` · `S조(자강·준자강)`.
**지역 급수**와 **전국 급수**를 각각 선택하며, 각 항목은 `(없음)` 선택 가능(둘 다 없음도 허용).

---

## 6. 폴더 구조

```
badminton_app/
├─ server.js              # 정적 서버 + /env.js + /healthz
├─ package.json           # 의존성 없음
├─ start.bat              # 로컬 실행(Windows)
├─ .env.example
├─ render.yaml            # Render Blueprint
├─ supabase_schema.sql    # 스키마 + RLS + Realtime + 트리거
└─ public/
   ├─ index.html
   ├─ css/style.css
   └─ js/
      ├─ util.js          # 급수/구력 상수·헬퍼
      ├─ supabase.js      # 클라이언트 초기화
      ├─ app.js           # 세션 라우팅
      ├─ auth.js          # 로그인/회원가입
      ├─ lobby.js         # 로비(프로필·방·실시간)
      └─ room.js          # 방 상세
```

## 향후(후속 작업)
- 알림 기능 상세, 사진 업로드(Supabase Storage), 방 매칭/게임 진행 로직, 설정 화면 확장.
