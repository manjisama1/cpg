import { Volume2, VolumeX, Zap, ZapOff } from 'lucide-react';
import { setPref, usePrefs } from '../prefs';
import { sfx } from '../sound';

export function PrefsBar() {
  const p = usePrefs();
  return (
    <div className="prefs" role="group" aria-label="Comfort settings">
      <button className="btn btn-ghost btn-icon btn-small" aria-pressed={p.sound}
        aria-label={p.sound ? 'Sound on. Turn sound off' : 'Sound off. Turn sound on'}
        onClick={() => { setPref('sound', !p.sound); if (!p.sound) window.setTimeout(() => sfx('confirm'), 30); }}>
        {p.sound ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
      </button>
      <button className="btn btn-ghost btn-icon btn-small" aria-pressed={p.reduceMotion}
        aria-label={p.reduceMotion ? 'Reduced motion on. Turn animations back on' : 'Reduce motion'}
        onClick={() => setPref('reduceMotion', !p.reduceMotion)}>
        {p.reduceMotion ? <ZapOff size={18} aria-hidden="true" /> : <Zap size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
