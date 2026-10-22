import { CHARACTERS, CHARACTER_COUNT } from '../characters';

const NAVY = '#1b2a49';

/**
 * One of the ten selectable characters. These are NOT role characters:
 * roles stay hidden, so the character only decides how a player looks.
 */
export function Avatar({ character, size = 96, dim = false, label }: {
  character: number; size?: number; dim?: boolean; label?: string;
}) {
  const c = ((character % CHARACTER_COUNT) + CHARACTER_COUNT) % CHARACTER_COUNT;
  const look = CHARACTERS[c];
  const body = look.body;
  const stroke = { stroke: NAVY, strokeWidth: 4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const thin = { ...stroke, strokeWidth: 3 };
  const delay = `${c * -0.6}s`;

  // Things that sit behind the head (ears), drawn first.
  const behind =
    c === 4 ? (<>
      <path d="M27 30 L25 7 L44 19 Z" fill={body} {...stroke} />
      <path d="M73 30 L75 7 L56 19 Z" fill={body} {...stroke} />
      <path d="M30 24 L29 13 L38 19 Z" fill="#ffd3e2" />
      <path d="M70 24 L71 13 L62 19 Z" fill="#ffd3e2" />
    </>)
    : c === 8 ? (<>
      <ellipse cx="38" cy="10" rx="8" ry="18" fill={body} {...stroke} />
      <ellipse cx="62" cy="10" rx="8" ry="18" fill={body} {...stroke} />
      <ellipse cx="38" cy="11" rx="3" ry="10" fill="#ffc2d6" />
      <ellipse cx="62" cy="11" rx="3" ry="10" fill="#ffc2d6" />
    </>)
    : null;

  // Things that sit on or in front of the face, drawn last.
  const front =
    c === 0 ? (<>
      <path d="M25 34 Q25 12 50 12 Q75 12 75 34 Z" fill={NAVY} {...stroke} />
      <circle cx="50" cy="9" r="5" fill="#ffc93c" {...thin} />
    </>)
    : c === 1 ? (<>
      <circle cx="40" cy="41" r="9.5" fill="rgba(255,255,255,.35)" {...thin} />
      <circle cx="60" cy="41" r="9.5" fill="rgba(255,255,255,.35)" {...thin} />
      <path d="M49.5 41 H50.5" {...thin} />
    </>)
    : c === 2 ? (
      <path d="M24 33 Q50 18 76 33 L76 40 Q50 27 24 40 Z" fill="#ff6b57" {...stroke} strokeWidth={3.5} />
    )
    : c === 3 ? (<>
      <path d="M50 16 Q50 8 54 4" fill="none" {...stroke} strokeWidth={3.5} />
      <path d="M54 4 Q64 2 66 10 Q57 12 54 4 Z" fill="#fff4dc" {...thin} />
    </>)
    : c === 5 ? (<>
      <path d="M31 29 L53 -2 L70 29 Z" fill="#7a5af5" {...stroke} />
      <ellipse cx="50" cy="29" rx="29" ry="6.5" fill="#7a5af5" {...stroke} />
      <circle cx="52" cy="14" r="3" fill="#ffc93c" />
      <circle cx="44" cy="23" r="2" fill="#ffc93c" />
    </>)
    : c === 6 ? (<>
      <path d="M24 42 Q24 11 50 11 Q76 11 76 42" fill="none" {...stroke} strokeWidth={5} />
      <rect x="17" y="35" width="11" height="19" rx="5" fill="#ffc93c" {...thin} />
      <rect x="72" y="35" width="11" height="19" rx="5" fill="#ffc93c" {...thin} />
    </>)
    : c === 7 ? (
      <path d="M30 22 L31 5 L41 14 L50 3 L59 14 L69 5 L70 22 Z" fill="#ffc93c" {...stroke} strokeWidth={3.5} />
    )
    : c === 9 ? (<>
      <rect x="28" y="35" width="20" height="13" rx="5" fill={NAVY} {...thin} />
      <rect x="52" y="35" width="20" height="13" rx="5" fill={NAVY} {...thin} />
      <path d="M48 40 H52" {...thin} />
      <path d="M32 39 L36 39" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M56 39 L60 39" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
    </>)
    : null;

  // Sunglasses cover the eyes, so skip the pupils for that one.
  const showEyes = c !== 9;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label ?? look.name}
      className="avatar" style={{ animationDelay: delay, opacity: dim ? 0.45 : 1 }}>
      <ellipse cx="50" cy="93" rx="26" ry="4.5" fill="rgba(27,42,73,.18)" />
      <g className="avatar-bob" style={{ animationDelay: delay }}>
        {behind}
        <path d="M22 90 Q22 62 50 62 Q78 62 78 90 Z" fill={body} {...stroke} />
        <circle cx="50" cy="42" r="26" fill={body} {...stroke} />
        <circle cx="33" cy="50" r="4" fill="#fff" opacity=".55" />
        <circle cx="67" cy="50" r="4" fill="#fff" opacity=".55" />
        {showEyes && (
          <g className="avatar-eyes">
            <circle cx="40" cy="41" r="6.5" fill="#fff" {...thin} />
            <circle cx="60" cy="41" r="6.5" fill="#fff" {...thin} />
            <circle cx="41" cy="42" r="2.6" fill={NAVY} />
            <circle cx="61" cy="42" r="2.6" fill={NAVY} />
          </g>
        )}
        <path d="M41 53 Q50 61 59 53" fill="none" {...stroke} strokeWidth={3.5} />
        {front}
      </g>
    </svg>
  );
}
