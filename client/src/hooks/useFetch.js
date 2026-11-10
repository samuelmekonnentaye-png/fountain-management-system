import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from '../api/client.js';

// Runs `fn` on mount and whenever `deps` change. Ignores out-of-date responses.
export function useFetch(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);

  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (id === seq.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (id === seq.current) setState({ data: null, loading: false, error: errMsg(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run };
}

export function useDebounced(value, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return v;
}
