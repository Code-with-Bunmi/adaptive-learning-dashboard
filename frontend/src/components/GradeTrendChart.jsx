import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

/** assignments: [{ title, grade }] from GET /student/trends. Ungraded work is filtered out. */
export default function GradeTrendChart({ assignments = [] }) {
  const data = assignments
    .filter((a) => a.grade !== null && a.grade !== undefined)
    .map((a, i) => ({ name: `A${i + 1}`, title: a.title, grade: Number(a.grade) }));

  if (!data.length) {
    return <p className="label py-8 text-center">No graded work yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#E7EAF0" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#54607A" />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono' }} stroke="#54607A" />
        <Tooltip
          formatter={(value, _n, item) => [`${value}%`, item.payload.title]}
          contentStyle={{ borderRadius: 8, borderColor: '#E7EAF0', fontFamily: 'Inter', fontSize: 13 }}
        />
        <Line type="monotone" dataKey="grade" stroke="#2E5C8A" strokeWidth={2.5} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
