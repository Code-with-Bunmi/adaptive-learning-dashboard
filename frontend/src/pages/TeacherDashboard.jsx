import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import Navbar from '../components/Navbar.jsx';
import KpiBreakdownCard from '../components/KpiBreakdownCard.jsx';
import AiFeedbackCard from '../components/AiFeedbackCard.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';

const LEVEL_DOT = { at_risk: 'bg-atrisk', watch: 'bg-watch', safe: 'bg-safe' };

export default function TeacherDashboard() {
  const { token } = useAuth();
  const { data: coursesData } = useApi((t) => api.teacherCourses(t));
  const courses = coursesData?.courses || [];
  const [activeCourseId, setActiveCourseId] = useState(null);
  const courseId = activeCourseId ?? courses[0]?.id;

  const [filter, setFilter] = useState('all'); // all | watch | at_risk
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [status, setStatus] = useState('');

  const { data: roster, refetch: refetchRoster } = useApi(
    (t) => (courseId ? api.teacherCourseStudents(t, courseId) : Promise.resolve(null)),
    [courseId]
  );
  const { data: trends } = useApi(
    (t) => (courseId ? api.teacherCourseTrends(t, courseId) : Promise.resolve(null)),
    [courseId]
  );
  const { data: scoringData, refetch: refetchScoring } = useApi(
    (t) => (courseId ? api.teacherGetScoringConfig(t, courseId) : Promise.resolve(null)),
    [courseId]
  );

  const students = (roster?.students || []).filter((s) =>
    filter === 'all' ? true : s.level === filter
  );

  const [weights, setWeights] = useState(null);
  React.useEffect(() => {
    if (scoringData?.config) {
      setWeights({
        weight_grade: Number(scoringData.config.weight_grade),
        weight_submission: Number(scoringData.config.weight_submission),
        weight_participation: Number(scoringData.config.weight_participation),
        threshold_watch: Number(scoringData.config.threshold_watch),
        threshold_at_risk: Number(scoringData.config.threshold_at_risk),
      });
    }
  }, [scoringData]);

  const recalculate = async () => {
    setStatus('Recalculating…');
    await api.teacherRecalculate(token, courseId);
    await refetchRoster();
    setStatus('Risk scores refreshed.');
    setTimeout(() => setStatus(''), 2500);
  };

  const saveWeights = async () => {
    const sum = weights.weight_grade + weights.weight_submission + weights.weight_participation;
    if (Math.abs(sum - 1) > 0.01) {
      setStatus(`Weights must total 100% (currently ${Math.round(sum * 100)}%).`);
      return;
    }
    try {
      await api.teacherUpdateScoringConfig(token, courseId, weights);
      await Promise.all([refetchRoster(), refetchScoring()]);
      setStatus('Weights updated and class rescored.');
    } catch (e) {
      setStatus(e.message);
    }
    setTimeout(() => setStatus(''), 4000);
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="label mb-1">Teacher dashboard</p>
        <h1 className="font-display text-3xl font-semibold text-ink">Your courses</h1>

        <div className="mt-6 flex flex-wrap gap-2">
          {courses.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setActiveCourseId(c.id);
                setSelectedStudentId(null);
              }}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                courseId === c.id ? 'bg-ink text-paper' : 'border border-ink/15 text-ink hover:border-ink'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {status && <p className="mt-4 rounded-lg bg-safe/10 px-4 py-2 text-sm text-safe">{status}</p>}

        {courseId && (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
            <div className="space-y-6">
              {/* Roster */}
              <div className="rounded-xl border border-ink/10 bg-surface shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 p-5">
                  <h3 className="font-display text-lg font-semibold text-ink">Class roster</h3>
                  <div className="flex gap-2">
                    {['all', 'watch', 'at_risk'].map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                          filter === f ? 'bg-ink text-paper' : 'border border-ink/15 text-ink'
                        }`}
                      >
                        {f.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="label border-b border-ink/10 text-left">
                      <th className="px-5 py-2 font-medium">Student</th>
                      <th className="px-5 py-2 text-right font-medium">Risk score</th>
                      <th className="px-5 py-2 text-right font-medium">Missing</th>
                      <th className="px-5 py-2 text-right font-medium">Late</th>
                      <th className="px-5 py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {students.map((s) => (
                      <tr key={s.id}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[s.level] || 'bg-slate-600'}`} />
                            <span className="font-medium text-ink">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-ink">{s.score ?? '—'}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-slate-600">{s.missing_count}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-slate-600">{s.late_count}</td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => setSelectedStudentId(s.id)}
                            className="rounded-full border border-ink/20 px-3 py-1 text-xs font-semibold hover:border-ink"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!students.length && (
                      <tr>
                        <td colSpan={5} className="px-5 py-6 text-center text-sm text-slate-600">
                          No students match this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Class-wide grade distribution */}
              <div className="rounded-xl border border-ink/10 bg-surface p-6 shadow-card">
                <h3 className="font-display text-lg font-semibold text-ink">Class-wide grade distribution</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={(trends?.assignments || []).map((a) => ({ name: a.title, avg: Number(a.avg_grade) || 0 }))}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid stroke="#E7EAF0" vertical={false} />
                    <XAxis dataKey="name" tick={false} stroke="#54607A" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#54607A" />
                    <Tooltip contentStyle={{ borderRadius: 8, fontFamily: 'Inter', fontSize: 13 }} />
                    <Bar dataKey="avg" fill="#2E5C8A" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Selected student drill-down */}
              {selectedStudentId && (
                <StudentDrilldown
                  courseId={courseId}
                  studentId={selectedStudentId}
                  onClose={() => setSelectedStudentId(null)}
                />
              )}
            </div>

            {/* Sidebar: weights */}
            <div className="space-y-6">
              <div className="rounded-xl border border-ink/10 bg-surface p-5 shadow-card">
                <h3 className="font-display text-base font-semibold text-ink">Scoring weights</h3>
                <p className="mt-1 text-xs text-slate-600">
                  {scoringData?.config?.course_id
                    ? 'Course-specific override (enabled by admin).'
                    : 'Showing the global default. Saving here only works if the admin has allowed per-course overrides.'}
                </p>
                {weights && (
                  <>
                    <div className="mt-4 space-y-4">
                      {[
                        ['weight_grade', 'Average grade'],
                        ['weight_submission', 'Submission rate'],
                        ['weight_participation', 'Participation'],
                      ].map(([key, label]) => (
                        <div key={key}>
                          <div className="flex justify-between text-xs text-slate-600">
                            <span>{label}</span>
                            <span className="font-mono">{Math.round(weights[key] * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={weights[key]}
                            onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
                            className="mt-1 w-full accent-brand"
                          />
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={saveWeights}
                      className="mt-4 w-full rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-ink/85"
                    >
                      Save & rescore class
                    </button>
                  </>
                )}
                <button
                  onClick={recalculate}
                  className="mt-2 w-full rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold hover:border-ink"
                >
                  Recalculate now
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline drill-down: a student's own breakdown + AI feedback, via the dedicated teacher-facing
 *  detail endpoint (§7 "Click a student → see their breakdown + AI feedback"). */
function StudentDrilldown({ courseId, studentId, onClose }) {
  const { data, loading, error } = useApi(
    (t) => api.teacherStudentDetail(t, courseId, studentId),
    [courseId, studentId]
  );

  return (
    <div className="rounded-xl border border-ink/10 bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-ink">
          {data?.student?.name || 'Student breakdown'}
        </h3>
        <button onClick={onClose} className="text-xs font-semibold text-slate-600 hover:text-ink">
          Close
        </button>
      </div>
      {loading && <p className="label mt-3">Loading…</p>}
      {error && <p className="mt-3 text-sm text-atrisk">{error}</p>}
      {data && (
        <div className="mt-4 space-y-4">
          <KpiBreakdownCard breakdown={data.riskScore.breakdown} />
          {data.feedback && <AiFeedbackCard feedback={data.feedback} />}
        </div>
      )}
    </div>
  );
}
