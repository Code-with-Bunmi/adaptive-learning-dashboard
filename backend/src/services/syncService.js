/**
 * Maps raw Google Classroom API responses into our Postgres schema, for both the "teacher
 * connected their account" path (full roster + all submissions) and the "student connected
 * directly" path (their own courses + own submissions only). Used by both the manual admin
 * sync endpoint and the nightly cron job.
 */
import pool from '../config/db.js';
import { hashGoogleSub } from './googleAuthService.js';
import { recomputeForCourse } from './scoringService.js';

/** Classroom's studentSubmission.state -> our simplified state enum + derived flags. */
function mapSubmission(sub, dueDate) {
  if (!sub || sub.state === 'CREATED' || sub.state === 'NEW') {
    return { state: 'MISSING', missing: true, late: false, grade: null, submittedAt: null };
  }
  const submittedAt = sub.updateTime ? new Date(sub.updateTime) : null;
  const isLate = Boolean(sub.late) || (submittedAt && dueDate && submittedAt > new Date(dueDate));

  return {
    state: isLate ? 'LATE' : sub.state === 'RETURNED' ? 'RETURNED' : 'TURNED_IN',
    missing: false,
    late: isLate,
    grade: sub.assignedGrade != null ? sub.assignedGrade : null,
    submittedAt,
  };
}

function dueDateFromClassroom(dueDate) {
  if (!dueDate) return null;
  return new Date(dueDate.year, dueDate.month - 1, dueDate.day);
}

async function upsertCourse(course, teacherId) {
  const { rows } = await pool.query(
    `INSERT INTO courses (classroom_course_id, name, section, teacher_id, synced_at)
     VALUES ($1,$2,$3,$4, NOW())
     ON CONFLICT (classroom_course_id) DO UPDATE SET name = $2, section = $3, synced_at = NOW()
     RETURNING id`,
    [course.id, course.name, course.section || null, teacherId]
  );
  return rows[0].id;
}

async function upsertAssignment(work, courseId) {
  const { rows } = await pool.query(
    `INSERT INTO assignments (classroom_coursework_id, course_id, title, due_date, max_points)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (classroom_coursework_id) DO UPDATE SET title = $3, due_date = $4, max_points = $5
     RETURNING id, due_date`,
    [work.id, courseId, work.title, dueDateFromClassroom(work.dueDate), work.maxPoints || 100]
  );
  return rows[0];
}

async function upsertSubmission(assignmentId, userId, sub, dueDate) {
  const mapped = mapSubmission(sub, dueDate);
  await pool.query(
    `INSERT INTO submissions (assignment_id, user_id, state, grade, submitted_at, late, missing)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (assignment_id, user_id) DO UPDATE SET
       state = $3, grade = $4, submitted_at = $5, late = $6, missing = $7`,
    [assignmentId, userId, mapped.state, mapped.grade, mapped.submittedAt, mapped.late, mapped.missing]
  );
}

async function ensureEnrolled(userId, courseId, role) {
  await pool.query(
    `INSERT INTO enrollments (user_id, course_id, role) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [userId, courseId, role]
  );
}

/** Finds or creates a local student user from a Classroom roster profile (email/name only —
 *  we don't have this student's own Google tokens, only what their teacher's roster call sees). */
async function upsertRosterStudent(profile) {
  const googleIdHash = hashGoogleSub(profile.userId || profile.id);
  const { rows: existing } = await pool.query('SELECT id FROM users WHERE google_id = $1', [googleIdHash]);
  if (existing.length) return existing[0].id;

  const { rows } = await pool.query(
    `INSERT INTO users (google_id, email, name, role) VALUES ($1,$2,$3,'student') RETURNING id`,
    [googleIdHash, profile.emailAddress || `${googleIdHash}@unknown.local`, profile.name?.fullName || 'Unknown Student']
  );
  return rows[0].id;
}

/** Full sync for a connected teacher: courses, roster, coursework, every student's submissions. */
export async function syncTeacherData(teacherUserId, liveData) {
  let coursesCount = 0, studentsCount = 0, assignmentsCount = 0, submissionsCount = 0;
  const affectedCourseIds = [];

  for (const { course, students, courseWork, submissionsByAssignment } of liveData) {
    const courseId = await upsertCourse(course, teacherUserId);
    await ensureEnrolled(teacherUserId, courseId, 'teacher');
    coursesCount++;
    affectedCourseIds.push(courseId);

    const studentIdByGoogleClassroomId = {};
    for (const s of students) {
      const localId = await upsertRosterStudent(s.profile);
      studentIdByGoogleClassroomId[s.profile.id || s.userId] = localId;
      await ensureEnrolled(localId, courseId, 'student');
      studentsCount++;
    }

    for (const work of courseWork) {
      const assignment = await upsertAssignment(work, courseId);
      assignmentsCount++;
      const subs = submissionsByAssignment[work.id] || [];
      for (const sub of subs) {
        const localStudentId = studentIdByGoogleClassroomId[sub.userId];
        if (!localStudentId) continue;
        await upsertSubmission(assignment.id, localStudentId, sub, assignment.due_date);
        submissionsCount++;
      }
    }
  }

  let studentsRescored = 0;
  for (const courseId of affectedCourseIds) {
    const scores = await recomputeForCourse(courseId);
    studentsRescored += scores.length;
  }

  return { coursesCount, studentsCount, assignmentsCount, submissionsCount, studentsRescored };
}

/** Self-sync for a connected student: their own enrolled courses + own submissions only. */
export async function syncStudentData(studentUserId, liveData) {
  let coursesCount = 0, assignmentsCount = 0, submissionsCount = 0;
  const affectedCourseIds = [];

  for (const { course, courseWork, submissionsByAssignment } of liveData) {
    const courseId = await upsertCourse(course, null); // teacher identity unknown from this view
    await ensureEnrolled(studentUserId, courseId, 'student');
    coursesCount++;
    affectedCourseIds.push(courseId);

    for (const work of courseWork) {
      const assignment = await upsertAssignment(work, courseId);
      assignmentsCount++;
      const subs = submissionsByAssignment[work.id] || [];
      if (subs[0]) {
        await upsertSubmission(assignment.id, studentUserId, subs[0], assignment.due_date);
        submissionsCount++;
      }
    }
  }

  let studentsRescored = 0;
  for (const courseId of affectedCourseIds) {
    const scores = await recomputeForCourse(courseId);
    studentsRescored += scores.length;
  }

  return { coursesCount, assignmentsCount, submissionsCount, studentsRescored };
}
