import { useEffect, useMemo, useState } from 'react';
import type { PublicState } from './types';

/**
 * Milliseconds left until a SERVER deadline. The client clock is only used to animate the
 * number: the offset comes from the server's own timestamp, and the server alone decides
 * when a phase really ends. While the match is paused the countdown freezes (the server
 * pushes the deadline back by the paused time when everyone returns).
 */
export function useRemaining(s: PublicState, deadline: number | null, freezeWhenPaused = true): number | null {
  const offset = useMemo(() => s.serverTime - Date.now(), [s]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const t = window.setInterval(() => bump((n) => n + 1), 200);
    return () => window.clearInterval(t);
  }, [deadline]);
  if (deadline === null) return null;
  const now = freezeWhenPaused && s.paused && s.pauseEndsAt !== null
    ? s.pauseEndsAt - s.settings.graceMs
    : Date.now() + offset;
  return Math.max(0, deadline - now);
}
