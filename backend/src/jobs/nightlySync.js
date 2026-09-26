/**
 * Nightly cron job (§2 "use a nightly cron job to sync — not real-time", §6 scheduler: node-cron).
 * For every connected teacher and student: fetch from Google Classroom -> store -> recompute
 * every affected course's risk scores -> pre-warm AI feedback for anyone now watch/at_risk.
 */
import cron from 'node-cron';
import pool from '../config/db.js';
import { getAuthorizedClient } from '../services/googleAuthService.js';
import { fetchTeacherClassroomData, fetchStudentClassroomData } from '../services/classroomService.js';
import { syncTeacherData, syncStudentData } from '../services/syncService.js';
import { getOrGenerateFeedback } from '../services/geminiService.js';
import { cache } from '../config/redisClient.js';

async function runNightlySync() {
  const { rows: logRows } = await pool.query(
    `INSERT INTO sync_logs (started_at, status) VALUES (NOW(), 'running') RETURNING id`
  );
  const logId = logRows[0].id;
  let recordsSynced = 0;
  let feedbackGenerated = 0;

  try {
    const { rows: teachers } = await pool.query(
      `SELECT u.id FROM users u JOIN google_tokens gt ON gt.user_id = u.id WHERE u.role = 'teacher'`
    );
    const { rows: students } = await pool.query(
      `SELECT u.id FROM users u JOIN google_tokens gt ON gt.user_id = u.id WHERE u.role = 'student'`
    );

    for (const { id: teacherId } of teachers) {
      try {
        const client = await getAuthorizedClient(teacherId);
        const liveData = await fetchTeacherClassroomData(client);
        const summary = await syncTeacherData(teacherId, liveData);
        recordsSynced += summary.coursesCount + summary.studentsCount + summary.assignmentsCount + summary.submissionsCount;
      } catch (err) {
        console.error(`[sync] Teacher ${teacherId} sync failed:`, err.message);
      }
    }

    for (const { id: studentId } of students) {
      try {
        const client = await getAuthorizedClient(studentId);
        const liveData = await fetchStudentClassroomData(client);
        const summary = await syncStudentData(studentId, liveData);
        recordsSynced += summary.coursesCount + summary.assignmentsCount + summary.submissionsCount;
      } catch (err) {
        console.error(`[sync] Student ${studentId} sync failed:`, err.message);
      }
    }

    // Queue AI feedback for anyone now watch/at_risk, so it's ready before students log in.
    const { rows: needsFeedback } = await pool.query(
      `SELECT rs.user_id, rs.course_id FROM risk_scores rs WHERE rs.level != 'safe'`
    );
    const { computeRiskScore } = await import('../services/scoringService.js');
    for (const row of needsFeedback) {
      try {
        const { rows: studentRows } = await pool.query('SELECT * FROM users WHERE id = $1', [row.user_id]);
        const { rows: courseRows } = await pool.query('SELECT * FROM courses WHERE id = $1', [row.course_id]);
        // Reconstruct the breakdown the feedback prompt needs (see studentController for why
        // this isn't persisted as a column — it's derived from the raw submissions each time).
        const fresh = await computeRiskScore(row.user_id, row.course_id);
        await getOrGenerateFeedback({ student: studentRows[0], course: courseRows[0], riskScore: fresh });
        feedbackGenerated++;
      } catch (err) {
        console.error(`[sync] Feedback generation failed for user ${row.user_id}:`, err.message);
      }
    }

    await pool.query(
      `UPDATE sync_logs SET finished_at = NOW(), status = 'success', records_synced = $1 WHERE id = $2`,
      [recordsSynced, logId]
    );
    await cache.delByPrefix('admin:overview');
    await cache.delByPrefix('teacher:course:');
    console.log(`[sync] Complete. ${recordsSynced} records synced, ${feedbackGenerated} feedback items generated.`);

    return {
      status: 'success',
      recordsSynced,
      feedbackGenerated,
      connectedTeachers: teachers.length,
      connectedStudents: students.length,
    };
  } catch (err) {
    console.error('[sync] Failed:', err.message);
    await pool.query(
      `UPDATE sync_logs SET finished_at = NOW(), status = 'failed', error_message = $1 WHERE id = $2`,
      [err.message, logId]
    );
    throw err;
  }
}

export function startNightlySync() {
  // Runs every day at 02:00 server time, per §2/§6.
  cron.schedule('0 2 * * *', runNightlySync);
  console.log('[cron] Nightly Google Classroom sync scheduled for 02:00 daily.');
}

// Exported for the admin "manual sync" button to reuse the exact same logic if desired later.
export { runNightlySync };
