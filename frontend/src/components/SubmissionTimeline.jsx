import React from 'react';

const STATE_META = {
  on_time: { color: 'bg-safe', label: 'On time' },
  late: { color: 'bg-watch', label: 'Late' },
  missing: { color: 'bg-atrisk', label: 'Missing' },
};

function classify(a) {
  if (a.missing) return 'missing';
  if (a.late) return 'late';
  return 'on_time';
}

/** assignments: [{ title, due_date, state, grade, submitted_at, late, missing }] */
export default function SubmissionTimeline({ assignments = [] }) {
  if (!assignments.length) {
    return <p className="label py-4 text-center">No assignments yet.</p>;
  }

  return (
    <div className="space-y-2">
      {assignments.map((a) => {
        const status = classify(a);
        const meta = STATE_META[status];
        return (
          <div key={a.title} className="flex items-center justify-between rounded-lg px-1 py-1.5 text-sm">
            <div className="flex items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full ${meta.color}`} />
              <span className="text-ink">{a.title}</span>
            </div>
            <span className="label">{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}
