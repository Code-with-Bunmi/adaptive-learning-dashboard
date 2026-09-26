import React from 'react';

const LEVEL_META = {
  safe: { color: '#2F8F5B', label: 'Safe' },
  watch: { color: '#C98A1F', label: 'Watch' },
  at_risk: { color: '#C1443A', label: 'At Risk' },
};

/** Big gauge showing 0-100 score, colored by level. Higher score = higher risk. */
export default function RiskGauge({ score = 0, level = 'safe', size = 148 }) {
  const meta = LEVEL_META[level] || LEVEL_META.safe;
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeScore = Math.max(0, Math.min(100, Number(score)));
  const offset = circumference - (safeScore / 100) * circumference;

  return (
    <div className="inline-flex flex-col items-center">
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} stroke="#E7EAF0" strokeWidth={10} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={meta.color}
            strokeWidth={10}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-semibold" style={{ color: meta.color }}>
            {Math.round(safeScore)}
          </span>
          <span className="label -mt-1">/ 100</span>
        </div>
      </div>
      <span
        className="mt-3 rounded-full px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wide"
        style={{ color: meta.color, backgroundColor: `${meta.color}1A` }}
      >
        {meta.label}
      </span>
    </div>
  );
}
