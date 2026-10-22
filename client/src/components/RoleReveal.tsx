import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import type { Role } from '../types';
import { ROLE_INFO, RoleAvatar } from './RoleArt';
import { useReducedMotion } from '../prefs';
import { sfx } from '../sound';

interface Props {
  role: Role; roundNo: number; totalRounds: number;
  skipIntro: boolean;   // true when joining mid-round (refresh/reconnect)
  onClose: () => void;
}

/** Private to this device: shows the player's OWN role from the server's private event. */
export function RoleReveal({ role, roundNo, totalRounds, skipIntro, onClose }: Props) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(skipIntro || reduced ? 0 : 3);
  const info = ROLE_INFO[role];

  useEffect(() => {
    if (n <= 0) { sfx('reveal'); return; }
    sfx('tick');
    const t = window.setTimeout(() => setN((x) => x - 1), 800);
    return () => window.clearTimeout(t);
  }, [n]);

  if (n > 0) {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label={`Round ${roundNo} is starting`}>
        <div className="countdown">
          <span className="eyebrow">Round {roundNo} of {totalRounds}</span>
          <div className="countdown-num" key={n} aria-live="assertive">{n}</div>
          <p>Get ready. Look at your own screen!</p>
        </div>
      </div>
    );
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="reveal-title">
      <div className="reveal-card card" style={{ ['--role' as string]: info.color }}>
        <span className="eyebrow"><Eye size={14} aria-hidden="true" /> Only you can see this</span>
        <RoleAvatar role={role} size={150} />
        <h2 id="reveal-title" className="reveal-name">{info.name}</h2>
        <p className="reveal-tag">{info.tagline}</p>
        <ul className="reveal-duties">{info.duties.map((d) => <li key={d}>{d}</li>)}</ul>
        <button className="btn btn-primary btn-big" autoFocus onClick={onClose}>Got it. Hide my role</button>
      </div>
    </div>
  );
}
