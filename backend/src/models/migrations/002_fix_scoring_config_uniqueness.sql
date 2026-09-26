-- Migration 002: fix a real bug found via live testing.
--
-- `UNIQUE (course_id) WHERE course_id IS NULL` (from 001_init.sql) does NOT actually prevent
-- duplicate global config rows: standard SQL unique semantics never treat two NULLs as equal
-- to each other, even inside a partial index, so that guard was silently a no-op. Confirmed
-- live: updating global weights via PUT /admin/scoring-config created a second course_id=NULL
-- row instead of replacing the first, and reads nondeterministically picked whichever row
-- Postgres happened to return first — so weight changes appeared to do nothing.
--
-- Fix: index a constant expression (`true`) instead of the (always-NULL, therefore
-- never-equal) `course_id` column itself. Two rows both indexed under the literal value
-- `true` DO correctly conflict, since `true` is never NULL.

-- 1. Clean up any duplicate global rows already created by the bug — keep the most recently
--    updated one, drop the rest.
DELETE FROM scoring_config
WHERE course_id IS NULL
  AND id NOT IN (
    SELECT id FROM scoring_config WHERE course_id IS NULL ORDER BY updated_at DESC LIMIT 1
  );

-- 2. Drop the broken index and replace it with one that actually enforces the invariant.
DROP INDEX IF EXISTS one_global_scoring_config;
CREATE UNIQUE INDEX IF NOT EXISTS one_global_scoring_config_v2
  ON scoring_config ((true)) WHERE course_id IS NULL;
