import React, { useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import KpiBreakdownCard from '../components/KpiBreakdownCard.jsx';
import AiFeedbackCard from '../components/AiFeedbackCard.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';

const LEVEL_DOT = { at_risk: 'bg-atrisk', watch: 'bg-watch', safe: 'bg-safe' };

function riskColor(avg) {
  if (avg == null) return '#E7EAF0';
  if (avg >= 70) return '#C1443A';
  if (avg >= 40) return '#C98A1F';
  return '#2F8F5B';
}

export default function AdminDashboard() {
  const { token } = useAuth();
  const { data: overview } = useApi((t) => api.adminOverview(t));
  const { data: coursesData, refetch: refetchCourses } = useApi((t) => api.adminCourses(t));
  const { data: scoringData, refetch: refetchScoring } = useApi((t) => api.adminGetScoringConfig(t));
  const { data: syncLogs, refetch: refetchLogs } = useApi((t) => api.adminSyncLogs(t));
  const { data: evalSummary } = useApi((t) => api.adminEvaluationSummary(t));

  const [status, setStatus] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [weights, setWeights] = useState(null);

  React.useEffect(() => {
    if (scoringData?.config) {
      setWeights({
        weight_grade: Number(scoringData.config.weight_grade),
        weight_submission: Number(scoringData.config.weight_submission),
        weight_participation: Number(scoringData.config.weight_participation),
        threshold_watch: Number(scoringData.config.threshold_watch),
        threshold_at_risk: Number(scoringData.config.threshold_at_risk),
        allow_teacher_override: scoringData.config.allow_teacher_override,
      });
    }
  }, [scoringData]);

  const saveWeights = async () => {
    const sum = weights.weight_grade + weights.weight_submission + weights.weight_participation;
    if (Math.abs(sum - 1) > 0.01) {
      setStatus(`Weights must total 100% (currently ${Math.round(sum * 100)}%).`);
      return;
    }
    try {
      await api.adminUpdateScoringConfig(token, weights);
      await Promise.all([refetchScoring(), refetchCourses()]);
      setStatus('Global weights updated — every course without its own override was rescored.');
    } catch (e) {
      setStatus(e.message);
    }
    setTimeout(() => setStatus(''), 5000);
  };

  const triggerSync = async () => {
    setStatus('Running sync…');
    try {
      const res = await api.adminTriggerSync(token);
      setStatus(`Sync complete — ${res.recordsSynced ?? 0} record(s) synced.`);
      await Promise.all([refetchCourses(), refetchLogs()]);
    } catch (e) {
      setStatus(e.message);
    }
    setTimeout(() => setStatus(''), 5000);
  };

  const courses = coursesData?.courses || [];

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="label mb-1">Admin dashboard</p>
        <h1 className="font-display text-3xl font-semibold text-ink">Program-wide analytics</h1>

        {status && <p className="mt-4 rounded-lg bg-safe/10 px-4 py-2 text-sm text-safe">{status}</p>}

        {/* KPI cards */}
        {overview && (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {[
              { label: 'Students', value: overview.userCounts.student || 0 },
              { label: 'Teachers', value: overview.userCounts.teacher || 0 },
              { label: 'Courses', value: overview.totalCourses },
              { label: 'Watch', value: overview.riskCounts.watch || 0, accent: 'text-watch' },
              { label: 'At risk', value: overview.riskCounts.at_risk || 0, accent: 'text-atrisk' },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-ink/10 bg-surface p-5 shadow-card">
                <p className="label">{kpi.label}</p>
                <p className={`mt-1 font-display text-3xl font-semibold ${kpi.accent || 'text-ink'}`}>
                  {kpi.value}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            {/* Course heatmap */}
            <div className="rounded-xl border border-ink/10 bg-surface p-6 shadow-card">
              <h3 className="font-display text-lg font-semibold text-ink">Course risk heatmap</h3>
              <p className="mt-1 text-xs text-slate-600">Click a course to drill down into its roster.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {courses.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCourseId(c.id)}
                    className="rounded-lg border border-ink/10 p-4 text-left transition hover:border-ink"
                    style={{ borderLeftWidth: 4, borderLeftColor: riskColor(Number(c.avg_risk_score)) }}
                  >
                    <p className="font-medium text-ink">{c.name}</p>
                    <p className="label mt-0.5">{c.teacher_name || 'Unassigned'}</p>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-slate-600">{c.enrolled} enrolled</span>
                      <span className="font-mono text-ink">avg {c.avg_risk_score ?? '—'}</span>
                    </div>
                    <div className="mt-1 flex gap-3 text-xs">
                      <span className="text-watch">{c.watch_count} watch</span>
                      <span className="text-atrisk">{c.at_risk_count} at risk</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {selectedCourseId && (
              <CourseDrilldown courseId={selectedCourseId} onClose={() => setSelectedCourseId(null)} />
            )}

            {/* Sync status/logs */}
            <div className="rounded-xl border border-ink/10 bg-surface shadow-card">
              <div className="flex items-center justify-between border-b border-ink/10 p-5">
                <h3 className="font-display text-lg font-semibold text-ink">Sync status</h3>
                <button
                  onClick={triggerSync}
                  className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-ink/85"
                >
                  Trigger sync now
                </button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="label border-b border-ink/10 text-left">
                    <th className="px-5 py-2 font-medium">Started</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 text-right font-medium">Records</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/5">
                  {(syncLogs?.logs || []).map((l) => (
                    <tr key={l.id}>
                      <td className="px-5 py-2 text-xs text-slate-600">
                        {new Date(l.started_at).toLocaleString()}
                      </td>
                      <td className="px-5 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            l.status === 'success'
                              ? 'bg-safe/10 text-safe'
                              : l.status === 'failed'
                              ? 'bg-atrisk/10 text-atrisk'
                              : 'bg-watch/10 text-watch'
                          }`}
                        >
                          {l.status}
                        </span>
                      </td>
                      <td className="px-5 py-2 text-right font-mono text-xs text-ink">{l.records_synced}</td>
                    </tr>
                  ))}
                  {!syncLogs?.logs?.length && (
                    <tr>
                      <td colSpan={3} className="px-5 py-6 text-center text-sm text-slate-600">
                        No sync runs recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Evaluation summary (SUS + feedback, §9) */}
            {evalSummary && (
              <div className="rounded-xl border border-ink/10 bg-surface p-6 shadow-card">
                <h3 className="font-display text-lg font-semibold text-ink">Pilot evaluation</h3>
                <div className="mt-3 flex gap-8 text-sm">
                  <div>
                    <p className="label">Avg. SUS score</p>
                    <p className="font-display text-2xl font-semibold text-ink">
                      {evalSummary.averageSusScore ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="label">SUS responses</p>
                    <p className="font-display text-2xl font-semibold text-ink">{evalSummary.susResponses}</p>
                  </div>
                  <div>
                    <p className="label">Feedback submissions</p>
                    <p className="font-display text-2xl font-semibold text-ink">{evalSummary.feedbackCount}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Global weight panel */}
          <div className="space-y-6">
            <div className="rounded-xl border border-ink/10 bg-surface p-5 shadow-card">
              <h3 className="font-display text-base font-semibold text-ink">Global scoring weights</h3>
              <p className="mt-1 text-xs text-slate-600">Applies to every course without its own override.</p>
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

                  <div className="mt-5 space-y-3 border-t border-ink/10 pt-4">
                    {[
                      ['threshold_watch', 'Watch threshold'],
                      ['threshold_at_risk', 'At-risk threshold'],
                    ].map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">{label}</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={weights[key]}
                          onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
                          className="w-16 rounded border border-ink/15 px-2 py-1 text-right font-mono"
                        />
                      </div>
                    ))}
                  </div>

                  <label className="mt-4 flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={weights.allow_teacher_override}
                      onChange={(e) => setWeights({ ...weights, allow_teacher_override: e.target.checked })}
                      className="accent-brand"
                    />
                    Allow teachers to override weights for their own course
                  </label>

                  <button
                    onClick={saveWeights}
                    className="mt-4 w-full rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper hover:bg-ink/85"
                  >
                    Save global weights
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Course drill-down for admin: full roster + click-through to a student's breakdown/feedback,
 *  reusing the teacher-facing endpoints (admins are authorized to view ANY course — see
 *  backend/src/controllers/teacherController.js's assertOwnsCourse). */
function CourseDrilldown({ courseId, onClose }) {
  const { data: roster } = useApi((t) => api.teacherCourseStudents(t, courseId), [courseId]);
  const [selectedStudentId, setSelectedStudentId] = useState(null);

  return (
    <div className="rounded-xl border border-ink/10 bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-ink/10 p-5">
        <h3 className="font-display text-lg font-semibold text-ink">Course roster</h3>
        <button onClick={onClose} className="text-xs font-semibold text-slate-600 hover:text-ink">
          Close
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="label border-b border-ink/10 text-left">
            <th className="px-5 py-2 font-medium">Student</th>
            <th className="px-5 py-2 text-right font-medium">Risk score</th>
            <th className="px-5 py-2 text-right font-medium">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/5">
          {(roster?.students || []).map((s) => (
            <tr key={s.id}>
              <td className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[s.level] || 'bg-slate-600'}`} />
                  <span className="font-medium text-ink">{s.name}</span>
                </div>
              </td>
              <td className="px-5 py-3 text-right font-mono text-xs text-ink">{s.score ?? '—'}</td>
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
        </tbody>
      </table>

      {selectedStudentId && (
        <div className="border-t border-ink/10 p-5">
          <StudentDetail courseId={courseId} studentId={selectedStudentId} />
        </div>
      )}
    </div>
  );
}

function StudentDetail({ courseId, studentId }) {
  const { data, loading } = useApi((t) => api.teacherStudentDetail(t, courseId, studentId), [courseId, studentId]);
  if (loading) return <p className="label">Loading…</p>;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <KpiBreakdownCard breakdown={data.riskScore.breakdown} />
      {data.feedback && <AiFeedbackCard feedback={data.feedback} />}
    </div>
  );
}
