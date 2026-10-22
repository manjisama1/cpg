import { Check, Crosshair, Hand, WifiOff } from 'lucide-react';
import type { PublicPlayer, Role } from '../types';
import { Avatar } from './Avatar';
import { ROLE_INFO, RoleAvatar, RoleBadge } from './RoleArt';
import { AnimatedNumber, signed } from './AnimatedNumber';

interface Props {
  player: PublicPlayer;
  isMe: boolean;
  verified?: Role;      // set only by a real, server-verified hand raise
  revealed?: Role;      // set only when the round is over
  roundDelta?: number;  // points earned this round (result phase)
  prevScore?: number;
  selectable?: boolean;
  selected?: boolean;
  isTarget?: boolean;   // the person who was accused this round
  onSelect?: () => void;
}

export function PlayerCard({ player, isMe, verified, revealed, roundDelta, prevScore, selectable, selected, isTarget, onSelect }: Props) {
  const shownRole = revealed ?? verified;
  const body = (
    <>
      {verified && !revealed && (
        <span className="hand-flag" aria-hidden="true"><Hand size={26} className="hand-wave" /></span>
      )}
      {isTarget && <span className="target-flag"><Crosshair size={14} aria-hidden="true" /> Accused</span>}
      {revealed ? <RoleAvatar role={revealed} size={74} /> : <Avatar character={player.character} size={74} dim={!player.connected} />}
      <span className="pc-name">{player.name}{isMe ? ' (you)' : ''}</span>
      {shownRole ? <RoleBadge role={shownRole} size="sm" /> : <span className="pill">Role hidden</span>}
      {verified && !revealed && (
        <span className="pill pill-verified"><Check size={12} aria-hidden="true" /> Verified {ROLE_INFO[verified].name}</span>
      )}
      {!player.connected && <span className="pill pill-off"><WifiOff size={12} aria-hidden="true" /> Offline</span>}
      <span className="pc-score">
        <AnimatedNumber value={player.score} from={prevScore ?? player.score} /> pts
        {roundDelta !== undefined && (
          <b className={`delta ${roundDelta > 0 ? 'up' : roundDelta < 0 ? 'down' : ''}`}> {signed(roundDelta)}</b>
        )}
      </span>
    </>
  );
  const cls = `pcard${isMe ? ' is-me' : ''}${selected ? ' is-selected' : ''}${verified ? ' is-verified' : ''}${isTarget ? ' is-target' : ''}`;
  if (selectable) {
    return (
      <li>
        <button className={`${cls} pcard-btn`} onClick={onSelect} aria-pressed={!!selected}
          aria-label={`Pick ${player.name}${selected ? ' (selected)' : ''}`}>{body}</button>
      </li>
    );
  }
  return <li><div className={cls}>{body}</div></li>;
}
