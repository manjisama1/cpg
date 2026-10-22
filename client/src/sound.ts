import { getPrefs } from './prefs';

// Tiny synthesized sound effects (no audio files). Nothing plays until the person has
// interacted with the page, because browsers keep the audio context locked until then.
export type Sfx = 'start' | 'reveal' | 'hand' | 'confirm' | 'tick' | 'alert' | 'submit' | 'win' | 'lose' | 'final';
type Note = [freq: number, at: number, dur: number];

const SEQ: Record<Sfx, Note[]> = {
  start: [[392, 0, .12], [523, .12, .18]],
  reveal: [[330, 0, .1], [440, .1, .1], [660, .2, .25]],
  hand: [[600, 0, .08], [800, .08, .14]],
  confirm: [[523, 0, .1], [659, .1, .1], [784, .2, .2]],
  tick: [[880, 0, .05]],
  alert: [[440, 0, .12], [440, .18, .12]],
  submit: [[300, 0, .08], [500, .08, .12]],
  win: [[523, 0, .12], [659, .12, .12], [784, .24, .12], [1047, .36, .35]],
  lose: [[392, 0, .18], [330, .18, .18], [262, .36, .35]],
  final: [[523, 0, .14], [659, .14, .14], [784, .28, .14], [1047, .42, .14], [784, .56, .14], [1047, .7, .45]],
};

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function sfx(name: Sfx) {
  if (!getPrefs().sound) return;
  try {
    const c = audio();
    if (!c || c.state === 'suspended') return;
    const t0 = c.currentTime + 0.01;
    for (const [freq, at, dur] of SEQ[name]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.09, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.02);
    }
  } catch { /* audio is a bonus, never a requirement */ }
}
