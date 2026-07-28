// Half-circle radial gauge for a single 0-100 score.
export default function Gauge({ value, color = 'var(--accent)', size = 140 }) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 45;
  const circumference = Math.PI * radius;
  const filled = (clamped / 100) * circumference;

  return (
    <svg viewBox="0 0 120 70" width={size} style={{ display: 'block', margin: '0 auto' }} role="img" aria-label={`Score ${clamped} out of 100`}>
      <path d="M10 65 A45 45 0 0 1 110 65" fill="none" style={{ stroke: 'var(--border)', strokeWidth: 10 }} />
      <path
        d="M10 65 A45 45 0 0 1 110 65"
        fill="none"
        style={{ stroke: color, strokeWidth: 10 }}
        strokeDasharray={`${filled} ${circumference}`}
        strokeLinecap="round"
      />
      <text x="60" y="55" textAnchor="middle" style={{ font: '700 22px inherit', fill: 'var(--text)' }}>
        {clamped}
      </text>
    </svg>
  );
}
