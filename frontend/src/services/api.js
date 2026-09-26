const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  // ---- Auth ----
  googleLogin: (code) => request('/auth/google', { method: 'POST', body: { code } }),
  devLogin: (email) => request('/auth/dev-login', { method: 'POST', body: { email } }),
  logout: (token) => request('/auth/logout', { method: 'POST', token }),
  me: (token) => request('/auth/me', { token }),

  // ---- Student ----
  studentDashboard: (token) => request('/student/dashboard', { token }),
  studentCourses: (token) => request('/student/courses', { token }),
  studentTrends: (token, courseId) => request(`/student/trends?courseId=${courseId}`, { token }),

  // ---- Teacher ----
  teacherCourses: (token) => request('/teacher/courses', { token }),
  teacherCourseStudents: (token, courseId) => request(`/teacher/course/${courseId}/students`, { token }),
  teacherAtRisk: (token, courseId) => request(`/teacher/course/${courseId}/at-risk`, { token }),
  teacherCourseTrends: (token, courseId) => request(`/teacher/course/${courseId}/trends`, { token }),
  teacherStudentDetail: (token, courseId, studentId) =>
    request(`/teacher/course/${courseId}/student/${studentId}`, { token }),
  teacherRecalculate: (token, courseId) =>
    request(`/teacher/course/${courseId}/recalculate`, { method: 'POST', token }),
  teacherGetScoringConfig: (token, courseId) => request(`/teacher/course/${courseId}/scoring-config`, { token }),
  teacherUpdateScoringConfig: (token, courseId, payload) =>
    request(`/teacher/course/${courseId}/scoring-config`, { method: 'PUT', body: payload, token }),

  // ---- Admin ----
  adminOverview: (token) => request('/admin/overview', { token }),
  adminCourses: (token) => request('/admin/courses', { token }),
  adminGetScoringConfig: (token) => request('/admin/scoring-config', { token }),
  adminUpdateScoringConfig: (token, payload) =>
    request('/admin/scoring-config', { method: 'PUT', body: payload, token }),
  adminTriggerSync: (token) => request('/admin/sync', { method: 'POST', token }),
  adminSyncLogs: (token) => request('/admin/sync-logs', { token }),
  adminEvaluationSummary: (token) => request('/admin/evaluation/summary', { token }),

  // ---- Evaluation (any signed-in role) ----
  submitSus: (token, answers) => request('/evaluation/sus', { method: 'POST', body: { answers }, token }),
  submitFeedback: (token, message) => request('/evaluation/feedback', { method: 'POST', body: { message }, token }),
};
