import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Calls fn now and then every `ms` while the component is shown, keeping the last good data.
 * `enabled` pauses polling (e.g. once a request has finished). Returns { data, error, reload }.
 */
export function usePoll(fn, ms, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: undefined, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const tick = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++tick.current;
    try {
      const data = await fnRef.current();
      if (mine === tick.current) setState({ data, error: null });
    } catch (error) {
      if (mine === tick.current && error.name !== 'AbortError') setState((s) => ({ data: s.data, error }));
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer;
    const loop = async () => {
      if (stopped) return;
      await reload();
      if (!stopped && enabled) timer = setTimeout(loop, ms);
    };
    loop();
    return () => {
      stopped = true;
      tick.current++; // ignore answers that arrive after the view changed
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled, reload, ...deps]);

  return { ...state, reload };
}

/** The current time, refreshed every `ms` (for countdowns). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** A value kept in localStorage (per browser), falling back to `initial` when storage is unavailable. */
export function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v;
    } catch {
      return initial;
    }
  });
  const store = useCallback((v) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* private mode */
    }
  }, [key]);
  return [value, store];
}
