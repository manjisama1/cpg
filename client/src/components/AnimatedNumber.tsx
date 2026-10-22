import { useEffect, useState } from 'react';
import { useReducedMotion } from '../prefs';

/** Counts from `from` to `value`. Jumps straight to the value if motion is reduced. */
export function AnimatedNumber({ value, from = 0 }: { value: number; from?: number }) {
  const reduced = useReducedMotion();
  const [v, setV] = useState(reduced ? value : from);
  useEffect(() => {
    if (reduced) { setV(value); return; }
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 800);
      setV(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, from, reduced]);
  return <>{v}</>;
}

export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
