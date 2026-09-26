# Setup Guide

Step-by-step instructions for running the Adaptive Learning Analytics Dashboard locally in
VS Code, and deploying it to Render. Read this fully before your first run — the Google Cloud
/ OAuth section is where most Classroom-API projects go wrong, so it's deliberately detailed.

---

## 0. Prerequisites

Install once, on your machine:

- **Node.js 18+** — https://nodejs.org
- **Docker Desktop** — https://www.docker.com/products/docker-desktop (runs Postgres + Redis locally; you do not need to install either one natively)
- **VS Code** — https://code.visualstudio.com

Check versions in a terminal:

```bash
node -v
docker -v
docker compose version
```

---

## 1. Open the project and start the data layer

```bash
# from the repo root
docker compose up -d
```

This starts Postgres (`localhost:5432`) and Redis (`localhost:6379`) in the background, exactly
as specified in Chapter 3. Confirm both are healthy:

```bash
docker compose ps
```

You should see both `aldash-postgres` and `aldash-redis` as `healthy`.

> Data persists in Docker volumes between restarts. To wipe everything and start fresh:
> `docker compose down -v`, then redo steps 2–3 below.

---

## 2. Backend: install, migrate, seed, run

```bash
cd backend
npm install
cp .env.example .env      # already present, but re-run if you reset it — see §5/§6 for real values
npm run migrate            # creates every table in Chapter 3 §5, plus supporting indexes
npm run seed                # creates Olubunmi + classmates + 3 courses + coursework (§11.5)
npm run dev                  # http://localhost:5000
```

You should see:

```
✔ Connected to Redis
✔ API running on http://localhost:5000
[cron] Nightly Google Classroom sync scheduled for 02:00 daily.
⚠ Dev-login bypass is ENABLED (NODE_ENV != production). Disable before deploying.
```

Leave this terminal running.

---

## 3. Frontend: install and run

Open a **second terminal**:

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
```

Open **http://localhost:5173** in your browser.

---

## 4. Try it without a real Google account (dev-login bypass)

On the login page, a **"Dev-only bypass"** panel appears automatically (it's gated on
`import.meta.env.DEV`, so it disappears entirely in a production build). Click any of the three
seeded accounts — no Google account, no password, nothing to configure:

| Role    | Email                                                                           |
| ------- | ------------------------------------------------------------------------------- |
| Student | `olowookere.bunmi001@gmail.com` — the running example used throughout Chapter 3 |
| Teacher | `teacher@demo.oau.edu.ng`                                                       |
| Admin   | `admin@demo.oau.edu.ng`                                                         |

Olubunmi's seeded data is **fixed, not random** (see `backend/src/models/runSeed.js`), so she
reliably shows one course as `at_risk`, one as `watch` (both with AI feedback), and one `safe`
(no feedback — by design, §7) every time you re-seed.

The underlying route, `POST /auth/dev-login`, is hard-`404`'d whenever `NODE_ENV=production` or
`DEV_LOGIN_ENABLED=false` (see `backend/src/middleware/devLoginGuard.js`) — it cannot accidentally
ship live. This is purely a local/dev convenience; it is **not** a second authentication system.

---

## 5. Connecting a real Google account ("Sign in with Google")

This is the part most Classroom-API projects get stuck on. Follow every step in order.

### 5.1 Create a Google Cloud project

1. Go to https://console.cloud.google.com/ → click the project dropdown (top left) → **New Project**.
2. Name it something like `oau-adaptive-learning-dashboard` → **Create**.
3. Make sure the new project is selected in the top dropdown before continuing.

### 5.2 Enable the Google Classroom API

1. **APIs & Services → Library** (left sidebar, or search "API Library").
2. Search **"Google Classroom API"** → open it → **Enable**.

### 5.3 Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** (unless your Google Workspace org restricts you to Internal — either
   works for this project; Internal is simpler if OAU has a Workspace domain, since it skips
   Google's verification review entirely).
3. Fill in the required fields (app name, support email, developer contact email).
4. **Scopes** step — click **Add or Remove Scopes** and add exactly these five (from Chapter 3 §11.4):
   ```
   https://www.googleapis.com/auth/classroom.courses.readonly
   https://www.googleapis.com/auth/classroom.rosters.readonly
   https://www.googleapis.com/auth/classroom.coursework.students.readonly
   https://www.googleapis.com/auth/classroom.student-submissions.me.readonly
   https://www.googleapis.com/auth/classroom.student-submissions.students.readonly
   ```
   These are also hardcoded in `backend/src/controllers/authController.js` and
   `backend/src/services/classroomService.js` for reference.
5. **Test users** step (only shown if your app is in "Testing" publishing status, which is the
   default and is fine for a final-year project): add every Google account you'll sign in with —
   your own, your supervisor's, any demo accounts. Accounts not on this list will get an
   "app not verified / access blocked" error from Google.
6. Save through to the summary page.

### 5.4 Create OAuth 2.0 credentials

1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: anything, e.g. `Adaptive Learning Dashboard — Web`.
4. **Authorized JavaScript origins** — add:
   ```
   http://localhost:5173
   ```
5. **Authorized redirect URIs** — this project uses the **popup-based** auth-code flow
   (`@react-oauth/google`'s `useGoogleLogin({ flow: 'auth-code' })`), which Google requires to use
   the literal string `postmessage` as its redirect URI — **not** a real URL. You do not need to
   add anything here for that flow to work; leave this section empty unless you later switch to
   the full-page-redirect flow.
6. **Create**. Copy the **Client ID** and **Client Secret** shown.

### 5.5 Put the credentials in both `.env` files

`backend/.env`:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

`frontend/.env`:

```
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

(Yes, the Client ID goes in both — the frontend needs it to render the Google button; the
backend needs both ID and Secret to exchange the auth code server-side. The **Secret** only ever
lives in `backend/.env`, never in the frontend.)

Restart both `npm run dev` processes after editing either `.env` file.

### 5.6 Sign in for real

Click **"Sign in with Google"** on the login page. You'll see Google's real consent screen
listing the five Classroom scopes. After approving, `backend/src/controllers/authController.js`
exchanges the code, calls the Classroom API to work out your role (teacher-in-any-course →
Teacher, student-only → Student, Workspace domain admin → Admin — see
`backend/src/services/classroomService.js`), and issues your app session.

> **If you get "Error 403: access_denied"**: your Google account isn't on the Test users list
> (§5.3 step 5) — add it and try again.
> **If you get "Error 400: redirect_uri_mismatch"**: something is using the full-page-redirect
> flow instead of the popup flow — check you didn't change `flow: 'auth-code'` in
> `frontend/src/pages/Login.jsx`.

---

## 6. Connecting Gemini for real AI feedback

1. Get a key at https://aistudio.google.com/apikey (separate from your OAuth Client ID/Secret —
   this is a Generative AI API key, unrelated to Classroom access).
2. Add it to `backend/.env`:
   ```
   GEMINI_API_KEY=your-key-here
   ```
3. Restart the backend. Feedback for `watch`/`at_risk` students now comes from
   `model: gemini-3.6-flash` instead of the built-in template fallback (`backend/src/services/geminiService.js`),
   and is still cached per §8's TTL rules (`AI_FEEDBACK_TTL_HOURS`, default 72h) so the same
   insight isn't regenerated — or re-billed — until new submission data arrives.

---

## 7. Running the nightly sync manually

The cron job (`backend/src/jobs/nightlySync.js`) runs automatically at 02:00 daily. To trigger it
on demand (e.g. right after connecting a real Google account, rather than waiting until 2am):
sign in as Admin → **"Trigger sync now"** on the Admin dashboard, or directly:

```bash
curl -X POST http://localhost:5000/api/admin/sync -H "Authorization: Bearer <admin-session-token>"
```

---

## 8. Deploying to Render

### 8.1 Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

`.env` files are git-ignored by default (see each package's `.gitignore`) — never commit real
credentials.

### 8.2 Managed Postgres + Redis

On Render: **New → PostgreSQL** and **New → Redis**, both in the same region as your web
services (lower latency, and Render's private networking is free within a region). Copy their
connection strings — you'll need them in step 8.3.

### 8.3 Backend — Web Service

**New → Web Service** → connect your repo → set **Root Directory** to `backend`.

- Build command: `npm install && npm run migrate`
- Start command: `npm start`
- Environment variables (mirror `backend/.env.example`, using Render's connection strings):
  ```
  NODE_ENV=production
  DEV_LOGIN_ENABLED=false
  DATABASE_URL=<Render Postgres internal connection string>
  REDIS_URL=<Render Redis internal connection string>
  SESSION_JWT_SECRET=<generate a new long random string — do not reuse your local one>
  CLIENT_URL=<your frontend's Render URL, filled in after step 8.4>
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  GOOGLE_REDIRECT_URI=<your frontend's Render URL>
  GEMINI_API_KEY=...
  AI_FEEDBACK_TTL_HOURS=72
  ```
  **`NODE_ENV=production` is what hard-disables the dev-login bypass** (§4) — double check this
  is set before going live.

### 8.4 Frontend — Static Site

**New → Static Site** → same repo → **Root Directory** `frontend`.

- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Environment variables:
  ```
  VITE_API_URL=<your backend's Render URL>/api
  VITE_GOOGLE_CLIENT_ID=...
  ```

### 8.5 Update Google Cloud OAuth settings for production

Back in Google Cloud Console (§5.4): add your live frontend URL
(`https://your-app.onrender.com`) to **Authorized JavaScript origins**. If your OAuth consent
screen is still in "Testing" mode, either add your real users to the Test users list, or submit
for verification if you need it open to arbitrary Google accounts (verification is not required
for a scoped final-year project pilot with a known list of students/staff).

### 8.6 GitHub Actions CI (optional, per Chapter 3 §3)

A minimal CI check — add `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 18 }
      - run: cd backend && npm install && node --check src/server.js
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 18 }
      - run: cd frontend && npm install && npm run build
```

Render auto-deploys on push by default, so this workflow is a pre-merge sanity check rather than
the deploy mechanism itself.

---

## Troubleshooting

| Problem                                                         | Fix                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:5432`                                   | Postgres container isn't running — `docker compose up -d`, then `docker compose ps` to confirm it's healthy.                                                                                                                                                            |
| `relation "users" does not exist`                               | Run `npm run migrate` inside `backend/`.                                                                                                                                                                                                                                |
| Dev-login panel doesn't appear                                  | You're running a production build (`npm run build` / `vite preview`), not `npm run dev` — the panel is gated on `import.meta.env.DEV` by design.                                                                                                                        |
| Dev-login route returns 404 even locally                        | Check `NODE_ENV` isn't accidentally set to `production` in `backend/.env`, and `DEV_LOGIN_ENABLED=true`.                                                                                                                                                                |
| Google sign-in: "access_denied"                                 | Your account isn't on the OAuth consent screen's Test users list (§5.3).                                                                                                                                                                                                |
| Google sign-in: "redirect_uri_mismatch"                         | Confirm `frontend/src/pages/Login.jsx` still uses `flow: 'auth-code'` (popup) — this flow needs no redirect URI registered.                                                                                                                                             |
| Weight changes on the Admin dashboard don't seem to do anything | Fixed in migration `002_fix_scoring_config_uniqueness.sql` — make sure `npm run migrate` has been run after pulling the latest code.                                                                                                                                    |
| AI feedback missing for an at-risk student                      | Feedback is intentionally **not** generated for `safe`-level students (§7) — check the student's actual level first. If they are `watch`/`at_risk` and still see nothing, check `GEMINI_API_KEY` is set (optional — falls back to a template automatically either way). |
