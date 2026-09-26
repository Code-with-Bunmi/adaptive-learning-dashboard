/**
 * Wraps the Google Classroom API. Two jobs:
 *   1. Role resolution right after login (teacher-in-any-course > student-only > domain admin).
 *   2. Nightly sync: pull courses, rosters, coursework, and submissions into our own schema.
 *
 * Only reads data the API actually exposes (§2 "Data reality"): grades, submission states,
 * timestamps, due dates, rosters, coursework. Never attempts to read file-open/login events —
 * Classroom has no such endpoint.
 */
import { google } from 'googleapis';

export const REQUIRED_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  // Best-effort only: most Workspace domains restrict this scope to already-privileged callers,
  // so admin detection below degrades gracefully if it isn't granted or the call is refused.
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
];

function classroomFor(client) {
  return google.classroom({ version: 'v1', auth: client });
}

/**
 * Determines role per §2: teacher in ANY course -> 'teacher'; else enrolled as student
 * anywhere -> 'student'; else (best-effort) Workspace domain admin -> 'admin'.
 * Falls back to 'student' if nothing is found (e.g. a brand-new account with no courses yet).
 */
export async function determineRole(client) {
  const classroom = classroomFor(client);

  const [teachingRes, enrolledRes] = await Promise.all([
    classroom.courses.list({ teacherId: 'me', courseStates: ['ACTIVE'] }).catch(() => ({ data: {} })),
    classroom.courses.list({ studentId: 'me', courseStates: ['ACTIVE'] }).catch(() => ({ data: {} })),
  ]);

  if ((teachingRes.data.courses || []).length > 0) return 'teacher';
  if ((enrolledRes.data.courses || []).length > 0) return 'student';

  // Best-effort admin check via the Admin SDK Directory API — only succeeds if the domain
  // actually granted the admin.directory.user.readonly scope to this app for this user.
  try {
    const admin = google.admin({ version: 'directory_v1', auth: client });
    const { data } = await admin.users.get({ userKey: 'me' });
    if (data.isAdmin) return 'admin';
  } catch {
    // Scope not granted, or caller isn't an admin — this is expected for most accounts.
  }

  return 'student';
}

/** Pulls a teacher's courses, full rosters, coursework, and every student's submissions. */
export async function fetchTeacherClassroomData(client) {
  const classroom = classroomFor(client);
  const { data } = await classroom.courses.list({ teacherId: 'me', courseStates: ['ACTIVE'] });
  const courses = data.courses || [];

  const results = [];
  for (const course of courses) {
    const [studentsRes, courseWorkRes] = await Promise.all([
      classroom.courses.students.list({ courseId: course.id }).catch(() => ({ data: {} })),
      classroom.courses.courseWork.list({ courseId: course.id }).catch(() => ({ data: {} })),
    ]);
    const students = studentsRes.data.students || [];
    const courseWork = courseWorkRes.data.courseWork || [];

    const submissionsByAssignment = {};
    for (const work of courseWork) {
      const { data: subData } = await classroom.courses.courseWork.studentSubmissions
        .list({ courseId: course.id, courseWorkId: work.id })
        .catch(() => ({ data: {} }));
      submissionsByAssignment[work.id] = subData.studentSubmissions || [];
    }

    results.push({ course, students, courseWork, submissionsByAssignment });
  }
  return results;
}

/** Pulls a student's own enrolled courses, coursework, and their own submissions only. */
export async function fetchStudentClassroomData(client) {
  const classroom = classroomFor(client);
  const { data } = await classroom.courses.list({ studentId: 'me', courseStates: ['ACTIVE'] });
  const courses = data.courses || [];

  const results = [];
  for (const course of courses) {
    const { data: courseWorkData } = await classroom.courses.courseWork
      .list({ courseId: course.id })
      .catch(() => ({ data: {} }));
    const courseWork = courseWorkData.courseWork || [];

    const submissionsByAssignment = {};
    for (const work of courseWork) {
      const { data: subData } = await classroom.courses.courseWork.studentSubmissions
        .list({ courseId: course.id, courseWorkId: work.id, userId: 'me' })
        .catch(() => ({ data: {} }));
      submissionsByAssignment[work.id] = subData.studentSubmissions || [];
    }
    results.push({ course, courseWork, submissionsByAssignment });
  }
  return results;
}
