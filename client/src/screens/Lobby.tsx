import { useState } from 'react';
import { Check, Copy, Crown, LogOut, Minus, Play, Plus, Share2, WifiOff, X } from 'lucide-react';
import { useGame } from '../game';
import { Avatar } from '../components/Avatar';
import { Chat } from '../components/Chat';
import type { PublicPlayer, Settings } from '../types';

const DISCUSSION = [30, 45, 60, 90, 120];
const GRACE = [30, 60, 120];

function Slot({ player, isMe, canKick, onKick }: {
  player: PublicPlayer | null; isMe: boolean; canKick: boolean; onKick: () => void;
}) {
  if (!player) {
    return (
      <li className="slot slot-empty">
        <div className="slot-empty-art" aria-hidden="true">?</div>
        <span className="slot-name">Waiting…</span>
        <span className="pill">Open seat</span>
      </li>
    );
  }
  return (
    <li className={`slot${player.ready ? ' is-ready' : ''}${isMe ? ' is-me' : ''}`}>
      {canKick && (
        <button className="slot-kick" onClick={onKick} aria-label={`Remove ${player.name}`}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
      <Avatar character={player.character} size={84} dim={!player.connected} />
      <span className="slot-name">{player.name}{isMe ? ' (you)' : ''}</span>
      <span className="slot-pills">
        {player.isHost && <span className="pill pill-host"><Crown size={14} aria-hidden="true" /> Host</span>}
        {!player.connected ? (
          <span className="pill pill-off"><WifiOff size={14} aria-hidden="true" /> Offline</span>
        ) : player.ready ? (
          <span className="pill pill-ready"><Check size={14} aria-hidden="true" /> Ready</span>
        ) : (
          <span className="pill">Not ready</span>
        )}
      </span>
    </li>
  );
}

function Stepper({ label, value, min, max, onChange, disabled }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled: boolean;
}) {
  return (
    <div className="setting">
      <span className="setting-label" id={`l-${label}`}>{label}</span>
      <div className="stepper" role="group" aria-labelledby={`l-${label}`}>
        <button className="btn btn-ghost btn-icon" disabled={disabled || value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label}`}>
          <Minus size={18} aria-hidden="true" />
        </button>
        <output aria-live="polite">{value}</output>
        <button className="btn btn-ghost btn-icon" disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function Choice({ label, options, value, onChange, disabled, unit }: {
  label: string; options: number[]; value: number; onChange: (v: number) => void; disabled: boolean; unit: string;
}) {
  return (
    <div className="setting">
      <span className="setting-label" id={`l-${label}`}>{label}</span>
      <div className="choice" role="radiogroup" aria-labelledby={`l-${label}`}>
        {options.map((o) => (
          <button key={o} role="radio" aria-checked={o === value} disabled={disabled}
            className={`chip${o === value ? ' on' : ''}`} onClick={() => onChange(o)}>
            {o}{unit}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Lobby() {
  const g = useGame();
  const s = g.state!;
  const isHost = s.hostId === g.myId;
  const me = s.players.find((p) => p.id === g.myId);
  const slots = [0, 1, 2, 3].map((i) => s.players[i] ?? null);
  const everyoneHere = s.players.length === 4 && s.players.every((p) => p.connected);
  const allReady = everyoneHere && s.players.every((p) => p.ready);
  const [starting, setStarting] = useState(false);

  const hint = s.players.length < 4
    ? `Waiting for ${4 - s.players.length} more player${4 - s.players.length > 1 ? 's' : ''}…`
    : !everyoneHere ? 'Waiting for everyone to reconnect…'
    : !allReady ? 'Waiting for everyone to be ready…'
    : isHost ? 'Everyone is ready. Start the game!' : 'Everyone is ready. Waiting for the host to start…';

  const patch = (p: Partial<Settings>) => void g.call('lobby:updateSettings', p);
  const link = `${location.origin}/?room=${s.code}`;

  async function copy() {
    try { await navigator.clipboard.writeText(s.code); g.notify('Room code copied!'); }
    catch { g.notify('Could not copy. Select the code and copy it by hand.', 'error'); }
  }
  async function share() {
    if (navigator.share) {
      try { await navigator.share({ title: 'Chor Police', text: `Join my Chor Police room: ${s.code}`, url: link }); return; }
      catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(link); g.notify('Invite link copied!'); }
    catch { g.notify('Could not share. Send the room code instead.', 'error'); }
  }
  async function start() {
    setStarting(true);
    await g.call('match:start');
    setStarting(false);
  }

  return (
    <main className="lobby">
      <div className="lobby-main">
        <section className="card code-card">
          <div>
            <span className="eyebrow">Room code</span>
            <div className="room-code" aria-label={`Room code ${s.code.split('').join(' ')}`}>{s.code}</div>
          </div>
          <div className="code-actions">
            <button className="btn btn-sky" onClick={copy}><Copy size={18} aria-hidden="true" /> Copy</button>
            <button className="btn btn-mint" onClick={share}><Share2 size={18} aria-hidden="true" /> Share</button>
          </div>
        </section>

        <ul className="slots" aria-label="Players">
          {slots.map((p, i) => (
            <Slot key={p?.id ?? `empty-${i}`} player={p} isMe={p?.id === g.myId}
              canKick={isHost && !!p && p.id !== g.myId}
              onKick={() => p && void g.call('lobby:kick', { playerId: p.id })} />
          ))}
        </ul>

        <section className="card controls">
          <p className="hint" role="status" aria-live="polite">{hint}</p>
          <div className="controls-row">
            <button className={`btn btn-big ${me?.ready ? 'btn-ghost' : 'btn-mint'}`}
              onClick={() => void g.call('lobby:ready', { ready: !me?.ready })} aria-pressed={!!me?.ready}>
              <Check aria-hidden="true" /> {me?.ready ? 'Not ready' : "I'm ready!"}
            </button>
            {isHost && (
              <button className="btn btn-primary btn-big" disabled={!allReady || starting} aria-busy={starting} onClick={start}>
                <Play aria-hidden="true" /> Start Game
              </button>
            )}
          </div>
        </section>

        <section className="card settings">
          <h2>Match settings {!isHost && <small>(host controls these)</small>}</h2>
          <Stepper label="Rounds" value={s.settings.rounds} min={1} max={10} disabled={!isHost}
            onChange={(v) => patch({ rounds: v })} />
          <Choice label="Discussion" unit="s" options={DISCUSSION} value={s.settings.discussionMs / 1000} disabled={!isHost}
            onChange={(v) => patch({ discussionMs: v * 1000 })} />
          <Choice label="Reconnect wait" unit="s" options={GRACE} value={s.settings.graceMs / 1000} disabled={!isHost}
            onChange={(v) => patch({ graceMs: v * 1000 })} />
          <p className="hint">The Officer orders the Police to find the <b>Chor</b> or the <b>Daket</b>. Police decision: {s.settings.investigationMs / 1000}s. Officer fallback: {s.settings.fallbackMs / 1000}s.</p>
        </section>

        <button className="btn btn-ghost leave" onClick={() => void g.leaveRoom()}>
          <LogOut size={18} aria-hidden="true" /> Leave room
        </button>
      </div>

      <aside className="lobby-chat">
        <Chat messages={g.chat} players={s.players} myId={g.myId}
          onSend={async (text) => (await g.call('chat:send', { text })).ok} />
      </aside>
    </main>
  );
}
