import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary.jsx';

// Real render-crash test — the whole point of this component is that a
// bug in one page shouldn't blank the entire app. This proves it actually
// catches the crash, that the caught error reaches the fallback, and that
// the "try again" path actually re-renders the children instead of being
// permanently stuck in the crashed state.
function Bomb({ shouldThrow }) {
  if (shouldThrow) throw new Error('boom from a page render');
  return <div>fine</div>;
}

// Mirrors the real usage in AppShell.jsx: the thing that decides whether
// to throw lives in a sibling, not the boundary itself — clicking "retry"
// only helps if something about the world actually changed in between.
function FlakyPage() {
  const [fixed, setFixed] = useState(false);
  return (
    <ErrorBoundary fallback={(error, reset) => (
      <button onClick={() => { setFixed(true); reset(); }}>retry</button>
    )}>
      <Bomb shouldThrow={!fixed} />
    </ErrorBoundary>
  );
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary fallback={() => <div>fallback</div>}>
        <div>real content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('real content')).toBeInTheDocument();
  });

  it('catches a render error and shows the fallback instead of crashing the whole tree', () => {
    // React logs caught errors to the console by default even though this
    // component handled them — silence that expected noise for this test.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary fallback={(error) => <div>Something broke: {error.message}</div>}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Something broke: boom from a page render/)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('lets the fallback\'s reset callback recover once the underlying problem is gone', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<FlakyPage />);

    // First render: the page throws, so the fallback (not "fine") is shown.
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
    expect(screen.queryByText('fine')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    // Retrying re-renders the real children, which no longer throw.
    expect(screen.getByText('fine')).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
