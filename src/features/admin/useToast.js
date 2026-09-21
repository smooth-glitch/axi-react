import { useCallback, useRef, useState } from 'react';

// Ported from toast() (core.js:1734-1744 — the live one; the 1184 duplicate
// was dead, overwritten by function-declaration hoisting in the original).
export function useToast() {
  const [state, setState] = useState(null); // { msg, isErr, show }
  const timerRef = useRef(null);

  const toast = useCallback((msg, isErr = false) => {
    clearTimeout(timerRef.current);
    setState({ msg, isErr, show: true });
    timerRef.current = setTimeout(() => setState((s) => (s ? { ...s, show: false } : s)), 2800);
  }, []);

  return [toast, state];
}
