import pool from '../config/db.js';
import { cache } from '../config/redisClient.js';
import { updateScoringConfig } from '../services/scoringService.js';
import { runNightlySync } from '../jobs/nightlySync.js';

/** GET /admin/overview — program-level analytics: safe/watch/at-risk counts, heatmap-ready data */
export async function getOverview(req, res) {
  try {
    const cached = await cache.get('admin:overview');
    if (cached) return res.json(cached);

    const [{ rows: levelCounts }, { rows: userCounts }, { rows: courseCount }] = await Promise.all([
      pool.query(`SELECT level, COUNT(DISTINCT user_id) FROM risk_scores GROUP BY level`),
      pool.query(`SELECT role, COUNT(*) FROM users GROUP BY role`),
      pool.query(`SELECT COUNT(*) FROM courses`),
    ]);

    const payload = {
      riskCounts: levelCounts.reduce((acc, r) => ({ ...acc, [r.level]: Number(r.count) }), {
        safe: 0,
        watch: 0,
        at_risk: 0,
      }),
      userCounts: userCounts.reduce((acc, r) => ({ ...acc, [r.role]: Number(r.count) }), {}),
      totalCourses: Number(courseCount[0].count),
    };

    await cache.set('admin:overview', payload, 300);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load overview.' });
  }
}

/** GET /admin/courses — every course with aggregate risk, for the program-wide heatmap */
export async function getCourses(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.section, t.name AS teacher_name,
              COUNT(DISTINCT e.user_id) FILTER (WHERE e.role = 'student') AS enrolled,
              ROUND(AVG(rs.score), 1) AS avg_risk_score,
              COUNT(DISTINCT rs.user_id) FILTER (WHERE rs.level = 'at_risk') AS at_risk_count,
              COUNT(DISTINCT rs.user_id) FILTER (WHERE rs.level = 'watch') AS watch_count
       FROM courses c
       LEFT JOIN users t ON t.id = c.teacher_id
       LEFT JOIN enrollments e ON e.course_id = c.id
       LEFT JOIN risk_scores rs ON rs.course_id = c.id
       GROUP BY c.id, t.name
       ORDER BY avg_risk_score DESC NULLS LAST`
    );
    res.json({ courses: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load courses.' });
  }
}

/** GET /admin/scoring-config — the global weights + thresholds */
export async function getScoringConfig(req, res) {
  const { rows } = await pool.query('SELECT * FROM scoring_config WHERE course_id IS NULL');
  res.json({ config: rows[0] });
}

/** PUT /admin/scoring-config — admin adjusts weights/thresholds without touching code (§1, §7) */
export async function putScoringConfig(req, res) {
  try {
    const { weight_grade, weight_submission, weight_participation, threshold_watch, threshold_at_risk, allow_teacher_override } = req.body;
    const updated = await updateScoringConfig({
      courseId: null,
      weights: { weight_grade, weight_submission, weight_participation },
      thresholds: { threshold_watch, threshold_at_risk },
      allowTeacherOverride: allow_teacher_override,
      updatedBy: req.user.id,
    });
    res.json({ config: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** POST /admin/sync — manually trigger the exact same sync the nightly cron job runs */
export async function triggerSync(req, res) {
  try {
    const summary = await runNightlySync();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: `Sync failed: ${err.message}` });
  }
}

/** GET /admin/sync-logs — for the "Sync status and logs" panel */
export async function getSyncLogs(req, res) {
  const { rows } = await pool.query('SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20');
  res.json({ logs: rows });
}

/** GET /admin/evaluation/summary — aggregated SUS score + feedback count (§9) */
export async function getEvaluationSummary(req, res) {
  const [{ rows: susRows }, { rows: fbRows }] = await Promise.all([
    pool.query('SELECT ROUND(AVG(sus_score), 1) AS avg_sus, COUNT(*) AS responses FROM sus_responses'),
    pool.query('SELECT COUNT(*) AS count FROM evaluation_feedback'),
  ]);
  res.json({ averageSusScore: susRows[0].avg_sus, susResponses: Number(susRows[0].responses), feedbackCount: Number(fbRows[0].count) });
}
