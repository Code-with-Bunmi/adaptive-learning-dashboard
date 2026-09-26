import React from 'react';

/** Feedback is only ever shown for watch/at_risk students — the backend doesn't generate it
 *  for 'safe' students at all. Clearly labeled per §7 ("labeled clearly as AI-generated insight"). */
export default function AiFeedbackCard({ feedback }) {
  if (!feedback) return null;

  return (
    <div className="rounded-xl border border-brand/20 bg-brand/5 p-6">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-brand px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-white">
          AI-generated insight
        </span>
      </div>
      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink">{feedback.content}</p>
    </div>
  );
}
