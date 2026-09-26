/**
 * Transparent weighted risk-scoring model (Chapter 3 §4). This is a plain formula, not a
 * machine-learning model — every number that feeds into the final score is computed here,
 * stored, and returned to the UI so a student, teacher, or admin can see exactly why a score
 * came out the way it did.
 *
 *   risk_score = grade_component * weight_grade
 *              + submission_component * weight_submission
 *              + participation_component * weight_participation
 *
 * Each component is normalized to 0–100, where HIGHER = MORE RISK (this matters: it means a
 * component of 0 is "no risk contribution from this factor", not "zero grade").
 *
 * Data-availability note: the Classroom API exposes submission state (TURNED_IN / LATE /
 * MISSING / RETURNED), grades, and timestamps — but NOT login or file-open activity. So:
 *   - submission_component   = on-time compliance:100 - (% of assignments submitted by their due date)
 *   - participation_component = engagement distinct from timeliness: 100 - (% of assignments with
 *                                ANY submission activity at all, on-time or late) — i.e. did the
 *                                student engage at all, versus did they engage on schedule. This
 *                                is the closest defensible proxy for "participation frequency"
 *                                available from real Classroom data (documented here since it's
 *                                an interpretive choice, not something the API labels directly).
 *   - grade_component        = 100 - (grade earned as a % of max_points, averaged across graded work)
 */
import pool from '../config/db.js';
import { cache } from '../config/redisClient.js';

function levelFor(score, thresholdWatch, thresholdAtRisk) {
  if (score >= thresholdAtRisk) return 'at_risk';
  if (score >= thresholdWatch) return 'watch';
  return 'safe';
}

/** Loads the effective scoring config for a course: per-course override if one exists AND the
 *  global row has allow_teacher_override = true, otherwise the global default. */
export async function getEffectiveScoringConfig(courseId) {
  const { rows: globalRows } = await pool.query(
    'SELECT * FROM scoring_config WHERE course_id IS NULL ORDER BY updated_at DESC LIMIT 1'
  );
  const global = globalRows[0];

  if (global?.allow_teacher_override) {
    const { rows: courseRows } = await pool.query('SELECT * FROM scoring_config WHERE course_id = $1', [
      courseId,
    ]);
    if (courseRows.length) return courseRows[0];
  }
  return global;
}

/** Computes and persists the risk score for one student in one course. Returns the full row,
 *  including the per-component breakdown the UI needs to render transparently. */
export async function computeRiskScore(userId, courseId) {
  const config = await getEffectiveScoringConfig(courseId);

  const { rows: subRows } = await pool.query(
    `SELECT s.state, s.grade, s.late, s.missing, s.submitted_at, a.due_date, a.max_points
     FROM submissions s
     JOIN assignments a ON a.id = s.assignment_id
     WHERE s.user_id = $1 AND a.course_id = $2`,
    [userId, courseId]
  );

  const total = subRows.length || 1;

  // Grade component: average of (grade / max_points * 100) across GRADED work only.
  const gradedRows = subRows.filter((r) => r.grade !== null && r.grade !== undefined);
  const avgGradePct = gradedRows.length
    ? gradedRows.reduce((sum, r) => sum + (Number(r.grade) / Number(r.max_points || 100)) * 100, 0) /
      gradedRows.length
    : 100; // no graded work yet -> don't penalize until data exists
  const gradeComponent = Math.max(0, Math.min(100, 100 - avgGradePct));

  // Submission component: on-time compliance rate.
  const onTimeCount = subRows.filter(
    (r) => !r.missing && r.state !== 'LATE' && (r.submitted_at ? new Date(r.submitted_at) <= new Date(r.due_date) : false)
  ).length;
  const onTimeRate = subRows.length ? (onTimeCount / total) * 100 : 100;
  const submissionComponent = Math.max(0, Math.min(100, 100 - onTimeRate));

  // Participation component: any-engagement rate (turned in at all, late or not).
  const engagedCount = subRows.filter((r) => !r.missing).length;
  const engagementRate = subRows.length ? (engagedCount / total) * 100 : 100;
  const participationComponent = Math.max(0, Math.min(100, 100 - engagementRate));

  const weightGrade = Number(config.weight_grade);
  const weightSubmission = Number(config.weight_submission);
  const weightParticipation = Number(config.weight_participation);

  const rawScore =
    gradeComponent * weightGrade + submissionComponent * weightSubmission + participationComponent * weightParticipation;
  const score = Math.round(Math.min(100, Math.max(0, rawScore)) * 100) / 100;
  const level = levelFor(score, Number(config.threshold_watch), Number(config.threshold_at_risk));

  const { rows } = await pool.query(
    `INSERT INTO risk_scores (user_id, course_id, score, grade_component, submission_component, participation_component, level, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, NOW())
     ON CONFLICT (user_id, course_id) DO UPDATE SET
       score = $3, grade_component = $4, submission_component = $5, participation_component = $6,
       level = $7, computed_at = NOW()
     RETURNING *`,
    [
      userId,
      courseId,
      score,
      Math.round(gradeComponent * 100) / 100,
      Math.round(submissionComponent * 100) / 100,
      Math.round(participationComponent * 100) / 100,
      level,
    ]
  );

  // Any cached "at-risk list" / class overview for this course is now stale.
  await cache.delByPrefix(`teacher:course:${courseId}`);
  await cache.delByPrefix(`admin:overview`);

  return {
    ...rows[0],
    breakdown: {
      weights: { grade: weightGrade, submission: weightSubmission, participation: weightParticipation },
      thresholds: { watch: Number(config.threshold_watch), atRisk: Number(config.threshold_at_risk) },
      factors: [
        {
          key: 'grade',
          label: 'Average Grade',
          contributionPoints: Math.round(gradeComponent * weightGrade * 100) / 100,
          plainEnglish: `Averaging ${avgGradePct.toFixed(1)}% across graded work.`,
        },
        {
          key: 'submission',
          label: 'Assignment Submission Rate',
          contributionPoints: Math.round(submissionComponent * weightSubmission * 100) / 100,
          plainEnglish: `${onTimeRate.toFixed(0)}% of assignments submitted on time (${onTimeCount} of ${subRows.length}).`,
        },
        {
          key: 'participation',
          label: 'Class Participation Frequency',
          contributionPoints: Math.round(participationComponent * weightParticipation * 100) / 100,
          plainEnglish: `Engaged with ${engagementRate.toFixed(0)}% of assignments (submitted something, on time or late).`,
        },
      ],
    },
  };
}

/** Recomputes risk scores for every enrolled student in a course. Used by nightly sync + admin/teacher manual triggers. */
export async function recomputeForCourse(courseId) {
  const { rows } = await pool.query(
    `SELECT user_id FROM enrollments WHERE course_id = $1 AND role = 'student'`,
    [courseId]
  );
  const results = [];
  for (const { user_id } of rows) {
    results.push(await computeRiskScore(user_id, courseId));
  }
  return results;
}

export async function updateScoringConfig({ courseId = null, weights, thresholds, allowTeacherOverride, updatedBy }) {
  const weightSum = Number(weights.weight_grade) + Number(weights.weight_submission) + Number(weights.weight_participation);
  if (Math.abs(weightSum - 1) > 0.01) {
    throw new Error('Weights must add up to 1.0 (100%).');
  }
  if (Number(thresholds.threshold_watch) >= Number(thresholds.threshold_at_risk)) {
    throw new Error('threshold_watch must be lower than threshold_at_risk.');
  }

  const params = [
    updatedBy,
    weights.weight_grade,
    weights.weight_submission,
    weights.weight_participation,
    thresholds.threshold_watch,
    thresholds.threshold_at_risk,
  ];

  let row;
  if (courseId === null) {
    // Explicit select-then-branch rather than ON CONFLICT: partial-unique-index expression
    // matching for "at most one NULL course_id row" is easy to get subtly wrong (see migration
    // 002's comment for a real bug this caused) — this is simpler to verify correct by reading.
    const { rows: existing } = await pool.query('SELECT id FROM scoring_config WHERE course_id IS NULL');
    if (existing.length) {
      const { rows } = await pool.query(
        `UPDATE scoring_config SET
           updated_by = $1, weight_grade = $2, weight_submission = $3, weight_participation = $4,
           threshold_watch = $5, threshold_at_risk = $6, allow_teacher_override = $7, updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [...params, allowTeacherOverride ?? false, existing[0].id]
      );
      row = rows[0];
    } else {
      const { rows } = await pool.query(
        `INSERT INTO scoring_config (course_id, updated_by, weight_grade, weight_submission, weight_participation, threshold_watch, threshold_at_risk, allow_teacher_override, updated_at)
         VALUES (NULL, $1,$2,$3,$4,$5,$6,$7, NOW())
         RETURNING *`,
        [...params, allowTeacherOverride ?? false]
      );
      row = rows[0];
    }
  } else {
    const { rows } = await pool.query(
      `INSERT INTO scoring_config (course_id, updated_by, weight_grade, weight_submission, weight_participation, threshold_watch, threshold_at_risk, updated_at)
       VALUES ($8, $1,$2,$3,$4,$5,$6, NOW())
       ON CONFLICT (course_id) DO UPDATE SET
         updated_by = $1, weight_grade = $2, weight_submission = $3, weight_participation = $4,
         threshold_watch = $5, threshold_at_risk = $6, updated_at = NOW()
       RETURNING *`,
      [...params, courseId]
    );
    row = rows[0];
  }

  if (courseId === null) {
    // Global weight change affects every course that doesn't have its own override — rescore all.
    const { rows: courses } = await pool.query('SELECT id FROM courses');
    for (const c of courses) await recomputeForCourse(c.id);
    await cache.delByPrefix('admin:overview');
  } else {
    await recomputeForCourse(courseId);
  }

  return row;
}
