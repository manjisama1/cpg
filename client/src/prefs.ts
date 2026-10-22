import { useEffect, useState, useSyncExternalStore } from 'react';

// Device-only comfort settings (sound, motion). They never touch game state.
export interface Prefs { sound: boolean; reduceMotion: boolean }
const KEY = 'cp.prefs';

function load(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return { sound: p?.sound !== false, reduceMotion: p?.reduceMotion === true };
  } catch { return { sound: true, reduceMotion: false }; }
}
let prefs: Prefs = load();
const subs = new Set<() => void>();
const apply = () => document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion);
apply();

export const getPrefs = () => prefs;
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs = { ...prefs, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  apply();
  subs.forEach((f) => f());
}
export function usePrefs(): Prefs {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => prefs);
}
/** True if the player turned motion off in the game OR their OS asks for reduced motion. */
export function useReducedMotion(): boolean {
  const p = usePrefs();
  const [os, setOs] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setOs(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return p.reduceMotion || os;
}
