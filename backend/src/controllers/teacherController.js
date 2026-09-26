import pool from '../config/db.js';
import { cache } from '../config/redisClient.js';
import { computeRiskScore, recomputeForCourse, updateScoringConfig, getEffectiveScoringConfig } from '../services/scoringService.js';
import { getOrGenerateFeedback } from '../services/geminiService.js';

/** GET /teacher/courses */
export async function getCourses(req, res) {
  const { rows } = await pool.query(
    `SELECT c.* FROM enrollments e JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1 AND e.role = 'teacher' ORDER BY c.name`,
    [req.user.id]
  );
  res.json({ courses: rows });
}

/** Admins can drill into ANY course (§7 "Course-level drill-down"); teachers only their own. */
async function assertOwnsCourse(userId, courseId, role) {
  if (role === 'admin') return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 AND role = 'teacher'`,
    [userId, courseId]
  );
  return rows.length > 0;
}

/** GET /teacher/course/:id/students — Student | Risk Score | Trend | Missing | Late | Action */
export async function getCourseStudents(req, res) {
  try {
    const courseId = Number(req.params.id);
    if (!(await assertOwnsCourse(req.user.id, courseId, req.user.role))) {
      return res.status(403).json({ error: 'You do not teach this course.' });
    }

    const cacheKey = `teacher:course:${courseId}:students`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, rs.score, rs.level, rs.grade_component,
              rs.submission_component, rs.participation_component, rs.computed_at,
              COUNT(s.id) FILTER (WHERE s.missing) AS missing_count,
              COUNT(s.id) FILTER (WHERE s.late) AS late_count
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN risk_scores rs ON rs.user_id = u.id AND rs.course_id = e.course_id
       LEFT JOIN submissions s ON s.user_id = u.id
         AND s.assignment_id IN (SELECT id FROM assignments WHERE course_id = e.course_id)
       WHERE e.course_id = $1 AND e.role = 'student'
       GROUP BY u.id, rs.score, rs.level, rs.grade_component, rs.submission_component, rs.participation_component, rs.computed_at
       ORDER BY COALESCE(rs.score, 0) DESC, u.name ASC`,
      [courseId]
    );

    const payload = { students: rows };
    await cache.set(cacheKey, payload, 300); // 5 min — invalidated immediately on any rescore anyway
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load class roster.' });
  }
}

/** GET /teacher/course/:id/at-risk — filtered to watch + at_risk only */
export async function getAtRiskStudents(req, res) {
  try {
    const courseId = Number(req.params.id);
    if (!(await assertOwnsCourse(req.user.id, courseId, req.user.role))) {
      return res.status(403).json({ error: 'You do not teach this course.' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, rs.score, rs.level, rs.grade_component, rs.submission_component, rs.participation_component
       FROM risk_scores rs JOIN users u ON u.id = rs.user_id
       WHERE rs.course_id = $1 AND rs.level IN ('watch', 'at_risk')
       ORDER BY rs.score DESC`,
      [courseId]
    );
    res.json({ students: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load at-risk list.' });
  }
}

/** GET /teacher/course/:id/trends — class-wide grade distribution */
export async function getCourseTrends(req, res) {
  try {
    const courseId = Number(req.params.id);
    if (!(await assertOwnsCourse(req.user.id, courseId, req.user.role))) {
      return res.status(403).json({ error: 'You do not teach this course.' });
    }

    const { rows } = await pool.query(
      `SELECT a.title, a.due_date,
              ROUND(AVG(s.grade) FILTER (WHERE s.grade IS NOT NULL), 1) AS avg_grade,
              COUNT(s.id) FILTER (WHERE s.missing) AS missing_count,
              COUNT(s.id) FILTER (WHERE s.late) AS late_count,
              COUNT(s.id) AS total
       FROM assignments a LEFT JOIN submissions s ON s.assignment_id = a.id
       WHERE a.course_id = $1 GROUP BY a.id ORDER BY a.due_date ASC NULLS LAST`,
      [courseId]
    );
    res.json({ assignments: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load course trends.' });
  }
}

/** GET /teacher/course/:id/student/:studentId — full transparent breakdown + AI feedback for
 *  ONE student, reusing exactly the same computation the student sees on their own dashboard
 *  (§7 "Click a student → see their breakdown + AI feedback"). */
export async function getStudentDetail(req, res) {
  try {
    const courseId = Number(req.params.id);
    const studentId = Number(req.params.studentId);
    if (!(await assertOwnsCourse(req.user.id, courseId, req.user.role))) {
      return res.status(403).json({ error: 'You do not teach this course.' });
    }

    const { rows: studentRows } = await pool.query(
      `SELECT u.* FROM users u JOIN enrollments e ON e.user_id = u.id
       WHERE u.id = $1 AND e.course_id = $2 AND e.role = 'student'`,
      [studentId, courseId]
    );
    if (!studentRows.length) return res.status(404).json({ error: 'Student not found in this course.' });
    const student = studentRows[0];

    const riskScore = await computeRiskScore(studentId, courseId);

    let feedback = null;
    if (riskScore.level !== 'safe') {
      const { rows: courseRows } = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
      feedback = await getOrGenerateFeedback({ student, course: courseRows[0], riskScore });
    }

    res.json({
      student: { id: student.id, name: student.name, email: student.email },
      riskScore,
      feedback,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load student detail.' });
  }
}

/** POST /teacher/course/:id/recalculate */
export async function recalculateCourse(req, res) {
  const courseId = Number(req.params.id);
  if (!(await assertOwnsCourse(req.user.id, courseId, req.user.role))) {
    return res.status(403).json({ error: 'You do not teach this course.' });
  }
  const scores = await recomputeForCourse(courseId);
  res.json({ recalculated: scores.length });
}

/** GET /teacher/course/:id/scoring-config — shows effective weights, and whether override is allowed */
export async function getCourseScoringConfig(req, res) {
  const courseId = Number(req.params.id);
  if (!(await assertOwnsCourse(req.user.id, courseId, req.user.role))) {
    return res.status(403).json({ error: 'You do not teach this course.' });
  }
  const config = await getEffectiveScoringConfig(courseId);
  res.json({ config });
}

/** PUT /teacher/course/:id/scoring-config — only works if admin has set allow_teacher_override */
export async function updateCourseScoringConfig(req, res) {
  try {
    const courseId = Number(req.params.id);
    if (!(await assertOwnsCourse(req.user.id, courseId, req.user.role))) {
      return res.status(403).json({ error: 'You do not teach this course.' });
    }

    const { rows: globalRows } = await pool.query('SELECT allow_teacher_override FROM scoring_config WHERE course_id IS NULL');
    if (!globalRows[0]?.allow_teacher_override) {
      return res.status(403).json({ error: 'Per-course weight overrides are not enabled by the admin.' });
    }

    const { weight_grade, weight_submission, weight_participation, threshold_watch, threshold_at_risk } = req.body;
    const updated = await updateScoringConfig({
      courseId,
      weights: { weight_grade, weight_submission, weight_participation },
      thresholds: { threshold_watch, threshold_at_risk },
      updatedBy: req.user.id,
    });
    res.json({ config: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
