import { Fingerprint, Search, ShieldCheck, VenetianMask, type LucideIcon } from 'lucide-react';
import type { Role } from '../types';

const NAVY = '#1b2a49';

export const ROLE_INFO: Record<Role, {
  name: string; color: string; icon: LucideIcon; tagline: string; duties: string[];
}> = {
  officer: {
    name: 'Officer', color: '#ffc93c', icon: ShieldCheck,
    tagline: 'You run the show.',
    duties: [
      'Raise your hand first and give the Police an order: find the Chor, or find the Daket.',
      'Guide the Police during the discussion.',
      'You win big if the Police finds who you ordered. You lose points if not.',
      'If the Police runs out of time, you get one fallback guess.',
    ],
  },
  police: {
    name: 'Police', color: '#5cc8f2', icon: Search,
    tagline: 'Find the Chor!',
    duties: [
      'Raise your hand when the Officer calls you.',
      'Question everyone in the discussion. Some will lie.',
      'Then pick the player the Officer ordered you to find (the Chor or the Daket).',
      'Run out of time and you lose 20 points.',
    ],
  },
  daket: {
    name: 'Daket', color: '#ff6b57', icon: VenetianMask,
    tagline: 'Stay out of trouble.',
    duties: [
      'You are not the Chor, but you can pretend to be anyone.',
      'Bluff in chat. You can even claim to be the Police.',
      'You win points when the Police picks the wrong person, and lose points when they find the target.',
      'You cannot raise a verified hand. Only the real Officer and Police can.',
    ],
  },
  chor: {
    name: 'Chor', color: '#62d6a5', icon: Fingerprint,
    tagline: 'Do not get caught.',
    duties: [
      'You are the one the Police is hunting.',
      'Bluff in chat. Point the finger at someone else.',
      'You win points when the Police picks the wrong person, and lose points when they find the target.',
      'You cannot raise a verified hand. Only the real Officer and Police can.',
    ],
  },
};

export function RoleBadge({ role, size = 'md' }: { role: Role; size?: 'sm' | 'md' }) {
  const info = ROLE_INFO[role];
  const Icon = info.icon;
  return (
    <span className={`role-badge role-badge-${size}`} style={{ background: info.color }}>
      <Icon size={size === 'sm' ? 14 : 18} aria-hidden="true" /> {info.name}
    </span>
  );
}

/** Role characters. Only shown to a player for their OWN role (reveal card) or publicly after a verified hand / round end. */
export function RoleAvatar({ role, size = 120 }: { role: Role; size?: number }) {
  const body = ROLE_INFO[role].color;
  const s = { stroke: NAVY, strokeWidth: 4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${ROLE_INFO[role].name} character`} className="avatar">
      <ellipse cx="50" cy="93" rx="26" ry="4.5" fill="rgba(27,42,73,.18)" />
      <g className="avatar-bob">
        <path d="M22 90 Q22 62 50 62 Q78 62 78 90 Z" fill={body} {...s} />
        <circle cx="50" cy="42" r="26" fill={body} {...s} />
        {role === 'chor' && (<>
          <path d="M30 76 H70 M26 84 H74" {...s} strokeWidth={3} />
        </>)}
        <g className="avatar-eyes">
          <circle cx="40" cy="41" r="6.5" fill="#fff" {...s} strokeWidth={3} />
          <circle cx="60" cy="41" r="6.5" fill="#fff" {...s} strokeWidth={3} />
          <circle cx={role === 'chor' ? 43 : 41} cy="42" r="2.6" fill={NAVY} />
          <circle cx={role === 'chor' ? 63 : 61} cy="42" r="2.6" fill={NAVY} />
        </g>
        {role === 'officer' && (<>
          <path d="M41 54 Q50 60 59 54" fill="none" {...s} strokeWidth={3.5} />
          <path d="M22 30 Q22 8 50 8 Q78 8 78 30 Z" fill={NAVY} {...s} />
          <path d="M20 31 H80" {...s} strokeWidth={5} />
          <path d="M50 13 l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8Z" fill="#ffc93c" {...s} strokeWidth={2.2} />
        </>)}
        {role === 'police' && (<>
          <path d="M41 54 Q50 58 59 54" fill="none" {...s} strokeWidth={3.5} />
          <path d="M16 30 H84" {...s} strokeWidth={6} />
          <path d="M28 30 Q28 10 50 10 Q72 10 72 30 Z" fill="#8a5a3c" {...s} />
          <path d="M28 25 H72" {...s} strokeWidth={3} />
          <circle cx="76" cy="66" r="9" fill="rgba(255,255,255,.55)" {...s} strokeWidth={3.5} />
          <path d="M82 72 L92 84" {...s} strokeWidth={5} />
        </>)}
        {role === 'daket' && (<>
          <path d="M26 36 Q50 30 74 36 L74 47 Q50 41 26 47 Z" fill={NAVY} {...s} strokeWidth={3} />
          <circle cx="40" cy="41" r="3" fill="#fff" /><circle cx="60" cy="41" r="3" fill="#fff" />
          <path d="M36 56 Q50 66 64 56" fill="none" {...s} strokeWidth={3.5} />
          <path d="M44 58 l3 5 M54 58 l3 5" {...s} strokeWidth={2.5} />
          <path d="M26 36 Q50 20 74 36 Q50 28 26 36 Z" fill="#fff4dc" {...s} strokeWidth={3} />
        </>)}
        {role === 'chor' && (<>
          <path d="M42 55 Q50 52 58 55" fill="none" {...s} strokeWidth={3.5} />
          <path d="M25 31 Q25 10 50 10 Q75 10 75 31 Z" fill="#fff" {...s} />
          <path d="M31 24 L36 12 M42 22 L45 10 M54 22 L55 10 M66 24 L62 12" {...s} strokeWidth={3.5} stroke={NAVY} />
          <circle cx="50" cy="7" r="4.5" fill="#fff" {...s} strokeWidth={3} />
        </>)}
      </g>
    </svg>
  );
}
