-- Migration 001: initial schema
-- Implements every table from Chapter 3 §5, plus three additions needed to actually run the
-- system (flagged clearly below so they're easy to review against the original spec):
--   1. google_tokens       — per-user OAuth access/refresh tokens (needed to call Classroom API
--                            on a user's behalf; the spec doesn't name this table but requires
--                            "Google OAuth 2.0" auth, which is not possible without it).
--   2. interaction_logs    — backs "Login/interaction logging for engagement metrics" (§9).
--   3. sus_responses / evaluation_feedback — backs the SUS survey + structured feedback
--                            collection requirements (§9).
-- scoring_config also gains a nullable course_id (global row = NULL) so a teacher can override
-- weights for just their own course, per §7 ("if allowed") — gated by allow_teacher_override
-- on the global row.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    VARCHAR(255) PRIMARY KEY,
  applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Users ────────────────────────────────────────────────────────────────────────────────────
-- google_id stores a SHA-256 hash of the Google account's subject identifier (never the raw
-- Google "sub"), per the "hash student IDs before storing" privacy requirement. Email/name are
-- kept in plaintext because they're required to match rosters during each Classroom sync and to
-- display identity in the UI — see docs/SETUP_GUIDE.md "Privacy notes" for the reasoning and the
-- trade-off this implies.
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  google_id       VARCHAR(128) UNIQUE NOT NULL,   -- sha256(google sub), hex-encoded
  email           VARCHAR(150) UNIQUE NOT NULL,
  name            VARCHAR(150) NOT NULL,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  consent_given   BOOLEAN NOT NULL DEFAULT TRUE,   -- interaction logging only occurs if true
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Per-user Google OAuth tokens, so the backend can call the Classroom API on their behalf
-- without asking them to reconnect on every visit.
CREATE TABLE IF NOT EXISTS google_tokens (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT,
  scope           TEXT,
  token_type      VARCHAR(50),
  expiry_date     BIGINT,
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Courses ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id                    SERIAL PRIMARY KEY,
  classroom_course_id   VARCHAR(255) UNIQUE,
  name                  VARCHAR(200) NOT NULL,
  section               VARCHAR(100),
  teacher_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  synced_at             TIMESTAMP
);

-- ── Enrollments ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enrollments (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL CHECK (role IN ('student', 'teacher')),
  UNIQUE(user_id, course_id)
);

-- ── Assignments (Classroom "courseWork") ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignments (
  id                        SERIAL PRIMARY KEY,
  classroom_coursework_id   VARCHAR(255) UNIQUE,
  course_id                 INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title                     VARCHAR(255) NOT NULL,
  due_date                  TIMESTAMP,
  max_points                NUMERIC(6,2) DEFAULT 100
);

-- ── Submissions ──────────────────────────────────────────────────────────────────────────────
-- `state` mirrors Classroom's studentSubmission.state values we actually use.
CREATE TABLE IF NOT EXISTS submissions (
  id              SERIAL PRIMARY KEY,
  assignment_id   INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state           VARCHAR(20) NOT NULL DEFAULT 'MISSING'
                   CHECK (state IN ('TURNED_IN', 'LATE', 'MISSING', 'RETURNED')),
  grade           NUMERIC(6,2),
  submitted_at    TIMESTAMP,
  late            BOOLEAN NOT NULL DEFAULT FALSE,
  missing         BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(assignment_id, user_id)
);

-- ── Scoring config (admin-adjustable weights + thresholds; NULL course_id = global default) ──
CREATE TABLE IF NOT EXISTS scoring_config (
  id                        SERIAL PRIMARY KEY,
  course_id                 INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  updated_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
  weight_grade              NUMERIC(4,3) NOT NULL DEFAULT 0.50,
  weight_submission         NUMERIC(4,3) NOT NULL DEFAULT 0.35,
  weight_participation      NUMERIC(4,3) NOT NULL DEFAULT 0.15,
  threshold_watch           NUMERIC(5,2) NOT NULL DEFAULT 40,
  threshold_at_risk         NUMERIC(5,2) NOT NULL DEFAULT 70,
  allow_teacher_override    BOOLEAN NOT NULL DEFAULT FALSE, -- set on the global (course_id IS NULL) row
  updated_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(course_id)
);
-- Partial unique index so there is at most one GLOBAL row (course_id IS NULL) as well.
CREATE UNIQUE INDEX IF NOT EXISTS one_global_scoring_config
  ON scoring_config (course_id) WHERE course_id IS NULL;

-- ── Risk scores ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_scores (
  id                        SERIAL PRIMARY KEY,
  user_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id                 INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  score                     NUMERIC(5,2) NOT NULL,
  grade_component           NUMERIC(5,2) NOT NULL,
  submission_component      NUMERIC(5,2) NOT NULL,
  participation_component   NUMERIC(5,2) NOT NULL,
  level                     VARCHAR(10) NOT NULL CHECK (level IN ('safe', 'watch', 'at_risk')),
  computed_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_risk_scores_user_course ON risk_scores(user_id, course_id);

-- ── AI feedback (generated ONLY for watch/at_risk students; LLM explains, never decides) ─────
CREATE TABLE IF NOT EXISTS ai_feedback (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id     INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  cache_key     VARCHAR(255) NOT NULL,
  generated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_cache_key ON ai_feedback(cache_key);

-- ── Sync logs (nightly cron job runs) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_logs (
  id               SERIAL PRIMARY KEY,
  started_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMP,
  status           VARCHAR(20) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'failed')),
  records_synced   INTEGER DEFAULT 0,
  error_message    TEXT
);

-- ── Evaluation: SUS survey + structured feedback (§9) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS sus_responses (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  role          VARCHAR(20),                 -- snapshot of role at time of response
  answers       JSONB NOT NULL,              -- the 10 standard SUS items, 1-5 each
  sus_score     NUMERIC(5,2) NOT NULL,       -- computed 0-100 SUS score
  submitted_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS evaluation_feedback (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  role          VARCHAR(20),
  message       TEXT NOT NULL,
  submitted_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Interaction / action logs (login + engagement metrics, §9; consent-gated) ────────────────
CREATE TABLE IF NOT EXISTS interaction_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method      VARCHAR(10) NOT NULL,
  path        VARCHAR(255) NOT NULL,
  status_code INTEGER,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interaction_logs_user ON interaction_logs(user_id, created_at);

-- Seed the single global scoring_config row (defaults match Chapter 3 §4 exactly) if absent.
INSERT INTO scoring_config (course_id, weight_grade, weight_submission, weight_participation, threshold_watch, threshold_at_risk)
SELECT NULL, 0.50, 0.35, 0.15, 40, 70
WHERE NOT EXISTS (SELECT 1 FROM scoring_config WHERE course_id IS NULL);
