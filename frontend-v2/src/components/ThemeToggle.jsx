import { useTheme } from '../theme/ThemeContext.jsx';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDaylight = theme === 'daylight';

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDaylight ? 'Switch to Onyx (dark)' : 'Switch to Daylight (light)'}
      title={isDaylight ? 'Switch to Onyx' : 'Switch to Daylight'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        color: 'var(--text-muted)',
        fontSize: 11.5,
        cursor: 'pointer',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {isDaylight ? (
          <path
            d="M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6L19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4L19 5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        )}
        {isDaylight && <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />}
      </svg>
      {isDaylight ? 'Daylight' : 'Onyx'}
    </button>
  );
}
