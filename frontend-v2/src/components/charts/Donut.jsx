// Lightweight hand-rolled donut chart — no charting library dependency.
export default function Donut({ segments, size = 100, thickness = 12, centerLabel }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const circumference = 2 * Math.PI * ((size - thickness) / 2);
  let offset = 0;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${centerLabel ?? total} total`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={(size - thickness) / 2}
        fill="none"
        style={{ stroke: 'var(--border)', strokeWidth: thickness }}
      />
      {segments.map((s, i) => {
        const length = (s.value / total) * circumference;
        const dashoffset = -offset;
        offset += length;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={(size - thickness) / 2}
            fill="none"
            style={{ stroke: s.color, strokeWidth: thickness }}
            strokeDasharray={`${length} ${circumference}`}
            strokeDashoffset={dashoffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
      })}
      {centerLabel !== undefined && (
        <text x={size / 2} y={size / 2 + 5} textAnchor="middle" style={{ font: '600 16px inherit', fill: 'var(--text)' }}>
          {centerLabel}
        </text>
      )}
    </svg>
  );
}
