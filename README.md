# Adaptive Learning Analytics Dashboard for Early Identification of At-Risk Students

**Obafemi Awolowo University (OAU) — Faculty of Computer Science and Engineering**
Scope: Part 5 students only. Transparent weighted scoring — no black-box ML.

Pulls real data from **Google Classroom API** (rosters, coursework, submissions, grades),
computes a transparent **weighted risk score (0–100)** per student, and uses the **Google Gemini
API**
purely to translate that score into encouraging, actionable feedback for at-risk students. The
score itself is always a formula, never an LLM judgment.

---

## Status: scaffolding stage

This is the project skeleton — folder structure and config files only, per the agreed delivery
order (scaffolding → backend → frontend → deployment guide → seed script). Backend and frontend
source files come next.

## Monorepo structure

```
adaptive-learning-dashboard/
├── backend/
│   ├── src/
│   │   ├── routes/         Express route definitions
│   │   ├── controllers/    Request handlers
│   │   ├── services/       classroom, gemini, scoring, redis cache
│   │   ├── models/         SQL schema, migrations, seed script
│   │   ├── middleware/     auth (session JWT), role guard, action-logging
│   │   ├── jobs/           nightly cron sync
│   │   └── server.js       app entry point
│   ├── tests/
│   ├── .env.example
│   └── package.json        ES modules ("type": "module")
├── frontend/
│   ├── src/
│   │   ├── pages/          Login, StudentDashboard, TeacherDashboard, AdminDashboard
│   │   ├── components/     shared UI (risk gauge, KPI breakdown card, charts)
│   │   ├── hooks/           useAuth, useApi, etc.
│   │   └── services/        API client
│   ├── .env.example
│   └── package.json         Vite + React + Recharts + @react-oauth/google
├── docs/                    SETUP_GUIDE.md, API docs (added in the setup-instructions step)
├── docker-compose.yml       Postgres + Redis for local dev
└── README.md                You are here
```

## Authentication model (no password form, ever)

- Frontend uses **Google Identity Services** via `@react-oauth/google`'s popup **authorization-code**
  flow — the person clicks "Sign in with Google," approves the requested Classroom scopes, and the
  browser hands the frontend a one-time code (never a password).
- That code is sent once to `POST /auth/google`, where the backend exchanges it server-side for
  Google access/refresh tokens using `google-auth-library`.
- The backend then calls the Classroom API to determine **role**: teacher in any course → Teacher;
  student-only → Student; Workspace domain admin → Admin.
- Our backend issues its **own** short-lived session token (`SESSION_JWT_SECRET`) for subsequent
  requests — this is not a Google credential, just our app's session, same as any other web app.
- **Dev-only bypass:** `POST /auth/dev-login` lets you pick a seeded demo user (e.g. Olubunmi)
  without a real Google Workspace account. It's hard-disabled (`404`) whenever `NODE_ENV=production`
  or `DEV_LOGIN_ENABLED=false` — see `backend/src/middleware/`.

## What's intentionally NOT here

- No document/file "open" tracking — the Classroom API doesn't expose it, so the risk model only
  ever uses submission rate, average grade, and participation frequency (all real API data).
- No black-box ML — `services/scoringService.js` (next step) is a plain, auditable weighted formula.
- No student-to-student comparison anywhere in the Student dashboard.

## Next steps (in order)

1. **Backend** — Express server, Google OAuth exchange + role resolution, PostgreSQL schema +
   migrations, Redis caching, cron job, scoring service, Gemini feedback service, dev-login bypass,
   action-logging middleware.
2. **Frontend** — React pages/components for Login, Student/Teacher/Admin dashboards, Recharts
   visualizations, role-based routing.
3. **`docs/SETUP_GUIDE.md`** — Google Cloud project + OAuth consent screen + scopes, env vars,
   running locally with Docker, deploying to Render.
4. **Seed script** — demo student **Olubunmi** plus classmates, courses, coursework, and
   submissions, so every dashboard is fully explorable via the dev-login bypass with zero live
   Google connection required.
