import pool from '../config/db.js';
import { cache } from '../config/redisClient.js';
import { computeRiskScore } from '../services/scoringService.js';
import { getOrGenerateFeedback, isConfigured as geminiConfigured } from '../services/geminiService.js';

/** GET /student/courses */
export async function getCourses(req, res) {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.section FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1 AND e.role = 'student'`,
    [req.user.id]
  );
  res.json({ courses: rows });
}

/**
 * GET /student/dashboard — own risk score breakdown + AI feedback (only if watch/at_risk).
 * No student-to-student comparison anywhere in this response, by design (§7).
 */
export async function getDashboard(req, res) {
  try {
    const { rows: courses } = await pool.query(
      `SELECT c.id, c.name, c.section FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = $1 AND e.role = 'student'`,
      [req.user.id]
    );

    const results = [];
    for (const course of courses) {
      let { rows: scoreRows } = await pool.query(
        'SELECT * FROM risk_scores WHERE user_id = $1 AND course_id = $2',
        [req.user.id, course.id]
      );
      let riskScore = scoreRows.length ? scoreRows[0] : await computeRiskScore(req.user.id, course.id);

      // risk_scores table doesn't persist the plain-English breakdown (that's derived at compute
      // time) — recompute it fresh if we loaded a stored row rather than a just-computed one.
      if (!riskScore.breakdown) riskScore = await computeRiskScore(req.user.id, course.id);

      let feedback = null;
      if (riskScore.level !== 'safe') {
        const { rows: studentRows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        feedback = await getOrGenerateFeedback({ student: studentRows[0], course, riskScore });
      }

      results.push({ course, riskScore, feedback });
    }

    res.json({ courses: results, aiConfigured: geminiConfigured });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard.' });
  }
}

/** GET /student/trends?courseId= — grade trend + submission timeline for charts */
export async function getTrends(req, res) {
  try {
    const courseId = Number(req.query.courseId);
    if (!courseId) return res.status(400).json({ error: 'courseId query param is required.' });

    const { rows } = await pool.query(
      `SELECT a.title, a.due_date, s.state, s.grade, s.submitted_at, s.late, s.missing
       FROM submissions s JOIN assignments a ON a.id = s.assignment_id
       WHERE s.user_id = $1 AND a.course_id = $2
       ORDER BY a.due_date ASC NULLS LAST`,
      [req.user.id, courseId]
    );
    res.json({ assignments: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load trends.' });
  }
}
