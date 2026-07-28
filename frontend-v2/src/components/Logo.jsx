export default function Logo({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2L4 5.5V11c0 5.2 3.4 9.9 8 11 4.6-1.1 8-5.8 8-11V5.5L12 2z"
        stroke="var(--accent)"
        strokeWidth="1.6"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
