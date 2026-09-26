import React from 'react';

/**
 * Shows the transparent, per-KPI breakdown of a risk score — every number here comes straight
 * from scoringService.js's `breakdown.factors`, never a black-box model. Tooltips explain each
 * metric in plain English per the Cognitive Load Theory design principle (Chapter 2).
 */
export default function KpiBreakdownCard({ breakdown }) {
  if (!breakdown) return null;

  return (
    <div className="rounded-xl border border-ink/10 bg-surface p-6 shadow-card">
      <h3 className="font-display text-lg font-semibold text-ink">Why this score?</h3>
      <p className="mt-1 text-sm text-slate-600">
        Every factor below adds points toward the score — the bigger the bar, the more it's
        pulling your standing down.
      </p>

      <div className="mt-5 space-y-4">
        {breakdown.factors.map((f) => {
          const weightPct = Math.round((breakdown.weights[f.key] ?? 0) * 100);
          const maxPossible = weightPct; // a factor can contribute at most its own weight (in points)
          const barPct = maxPossible ? Math.min(100, (f.contributionPoints / maxPossible) * 100) : 0;
          return (
            <div key={f.key}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-ink">
                  {f.label} <span className="label font-normal">({weightPct}% weight)</span>
                </span>
                <span className="font-mono text-xs text-slate-600">+{f.contributionPoints.toFixed(1)} pts</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-paper">
                <div className="h-full rounded-full bg-brand" style={{ width: `${barPct}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-600">{f.plainEnglish}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-5 border-t border-ink/10 pt-3 text-xs text-slate-600">
        Flagged <span className="font-medium text-watch">Watch</span> at{' '}
        {breakdown.thresholds.watch}+ and <span className="font-medium text-atrisk">At Risk</span> at{' '}
        {breakdown.thresholds.atRisk}+, out of 100. This is a fixed formula — no machine-learning
        model is involved in this decision.
      </p>
    </div>
  );
}
