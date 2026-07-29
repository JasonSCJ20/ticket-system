import { useCallback, useState } from 'react';

// Shared success/error banner state for pages that perform actions (create,
// update, confirm, etc.) — replaces each page hand-rolling its own
// message/setMessage pair so error detail (including multi-field validation
// errors) is surfaced consistently everywhere.
export function useActionFeedback() {
  const [feedback, setFeedback] = useState(null);

  const notify = useCallback((tone, text, details) => {
    setFeedback({ tone, text, details: details && details.length > 1 ? details : null });
  }, []);

  const notifyError = useCallback((err, fallback = 'Something went wrong.') => {
    setFeedback({
      tone: 'critical',
      text: err?.message || fallback,
      details: err?.validationErrors?.length > 1 ? err.validationErrors : null,
    });
  }, []);

  const notifySuccess = useCallback((text) => {
    setFeedback({ tone: 'ok', text, details: null });
  }, []);

  const clear = useCallback(() => setFeedback(null), []);

  return { feedback, notify, notifyError, notifySuccess, clear };
}
