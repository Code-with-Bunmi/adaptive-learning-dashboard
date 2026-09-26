import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth.jsx';

/**
 * Fetches `fetcher(token)` on mount and whenever `deps` change. Returns { data, loading, error,
 * refetch }. Kept intentionally simple — this is a dashboard, not a data-fetching library.
 */
export function useApi(fetcher, deps = []) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const run = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    fetcher(token)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ...deps]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  return { data, loading, error, refetch: run };
}
