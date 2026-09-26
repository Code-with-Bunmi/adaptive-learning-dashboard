import React, { useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import RiskGauge from '../components/RiskGauge.jsx';
import KpiBreakdownCard from '../components/KpiBreakdownCard.jsx';
import GradeTrendChart from '../components/GradeTrendChart.jsx';
import SubmissionTimeline from '../components/SubmissionTimeline.jsx';
import AiFeedbackCard from '../components/AiFeedbackCard.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../services/api.js';

export default function StudentDashboard() {
  const { user } = useAuth();
  const { data, loading, error } = useApi((token) => api.studentDashboard(token));
  const [activeCourseId, setActiveCourseId] = useState(null);

  const courses = data?.courses || [];
  const active = courses.find((c) => c.course.id === activeCourseId) || courses[0];

  const { data: trends } = useApi(
    (token) => (active ? api.studentTrends(token, active.course.id) : Promise.resolve(null)),
    [active?.course.id]
  );

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="label mb-1">Your dashboard</p>
        <h1 className="font-display text-3xl font-semibold text-ink">
          Hi {user?.name?.split(' ')[0]}.
        </h1>

        {loading && <p className="label mt-8">Loading…</p>}
        {error && <p className="mt-4 rounded-lg bg-atrisk/10 px-4 py-3 text-sm text-atrisk">{error}</p>}

        {!loading && !courses.length && (
          <p className="mt-8 text-sm text-slate-600">
            No enrolled courses found yet — your data syncs from Google Classroom nightly, or an
            admin can trigger a sync manually.
          </p>
        )}

        {courses.length > 0 && (
          <div className="mt-8 grid gap-8 md:grid-cols-[200px_1fr]">
            <nav className="space-y-1.5">
              {courses.map(({ course, riskScore }) => (
                <button
                  key={course.id}
                  onClick={() => setActiveCourseId(course.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
                    (active?.course.id ?? courses[0].course.id) === course.id
                      ? 'bg-ink text-paper'
                      : 'hover:bg-surface'
                  }`}
                >
                  <span className="font-medium">{course.name}</span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      riskScore.level === 'at_risk'
                        ? 'bg-atrisk'
                        : riskScore.level === 'watch'
                        ? 'bg-watch'
                        : 'bg-safe'
                    }`}
                  />
                </button>
              ))}
            </nav>

            {active && (
              <div className="space-y-6">
                <div className="grid gap-6 rounded-xl border border-ink/10 bg-surface p-6 shadow-card sm:grid-cols-[auto_1fr]">
                  <RiskGauge score={active.riskScore.score} level={active.riskScore.level} />
                  <div>
                    <h2 className="font-display text-xl font-semibold text-ink">{active.course.name}</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      This score reflects your own progress only — it is never compared against
                      other students.
                    </p>
                  </div>
                </div>

                <KpiBreakdownCard breakdown={active.riskScore.breakdown} />

                {active.feedback && <AiFeedbackCard feedback={active.feedback} />}

                <div className="rounded-xl border border-ink/10 bg-surface p-6 shadow-card">
                  <h3 className="font-display text-lg font-semibold text-ink">Grade trend</h3>
                  <GradeTrendChart assignments={trends?.assignments || []} />
                </div>

                <div className="rounded-xl border border-ink/10 bg-surface p-6 shadow-card">
                  <h3 className="font-display text-lg font-semibold text-ink">Submission timeline</h3>
                  <SubmissionTimeline assignments={trends?.assignments || []} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
