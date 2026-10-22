import { useEffect, useRef, useState } from 'react';
import { Clock, Crosshair, Eye, Hand, Hourglass, LogOut, Search, SkipForward, WifiOff } from 'lucide-react';
import '../match.css';
import { useGame } from '../game';
import { useRemaining } from '../hooks';
import { sfx } from '../sound';
import { Chat } from '../components/Chat';
import { PlayerCard } from '../components/PlayerCard';
import { PrefsBar } from '../components/PrefsBar';
import { RoleBadge, ROLE_INFO } from '../components/RoleArt';
import { RoleReveal } from '../components/RoleReveal';
import { RoundResultPanel } from './RoundResult';
import { FinalScreen, AbortedScreen } from './Final';
import type { Order, Phase, PublicState } from '../types';

const ORDER_NAME: Record<Order, string> = { chor: 'Chor', daket: 'Daket' };

const PHASE_LABEL: Record<Phase, string> = {
  officer_call: 'Officer, raise your hand',
  police_confirm: 'Police, raise your hand',
  discussion: 'Discussion',
  investigation: 'Police decides',
  fallback: 'Officer fallback guess',
  result: 'Round result',
};

function Timer({ s, total }: { s: PublicState; total: number }) {
  const rem = useRemaining(s, s.round?.deadline ?? null);
  const secs = rem === null ? null : Math.ceil(rem / 1000);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (secs !== null && secs > 0 && secs <= 5 && secs !== last.current && !s.paused) sfx('tick');
    last.current = secs;
  }, [secs, s.paused]);
  if (rem === null || secs === null) return null;
  return (
    <div className={`timer${secs <= 10 ? ' urgent' : ''}${s.paused ? ' paused' : ''}`} role="timer" aria-label={`${secs} seconds left`}>
      <Clock size={20} aria-hidden="true" />
      <span className="timer-num">{secs}s</span>
      <span className="timer-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (rem / total) * 100)}%` }} /></span>
    </div>
  );
}

function PauseBanner({ s }: { s: PublicState }) {
  const rem = useRemaining(s, s.pauseEndsAt, false);
  if (!s.paused) return null;
  const offline = s.players.filter((p) => !p.connected).map((p) => p.name).join(', ');
  return (
    <div className="pause-banner" role="status">
      <WifiOff size={20} aria-hidden="true" />
      <span>Paused. Waiting for {offline || 'a player'} to reconnect ({Math.ceil((rem ?? 0) / 1000)}s left). The timer is frozen.</span>
    </div>
  );
}

export default function Match() {
  const g = useGame();
  const s = g.state!;
  if (s.state === 'complete') return <FinalScreen />;
  if (s.state === 'aborted') return <AbortedScreen />;
  return <Round />;
}

function Round() {
  const g = useGame();
  const s = g.state!;
  const round = s.round;
  const phase = round?.phase ?? 'officer_call';
  const myRole = g.priv?.roundNo === s.roundNo ? g.priv.role : null;
  const isHost = s.hostId === g.myId;
  const [seenRound, setSeenRound] = useState(0);
  const [peek, setPeek] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null); // the Officer's choice before raising their hand
  // If this tab loaded after the round had already begun (refresh/reconnect), skip the 3-2-1 intro.
  const skipRound = useRef(phase !== 'officer_call' ? s.roundNo : 0);

  const result = round?.result ?? null;
  const verified = round?.verified ?? {};
  const orderNow = round?.order ?? null;
  const target = orderNow ? ORDER_NAME[orderNow] : 'target';
  const skipVotes = round?.skipVotes ?? [];
  const iVotedSkip = !!g.myId && skipVotes.includes(g.myId);

  // Reset the target selection whenever the phase or round changes.
  useEffect(() => { setPick(null); }, [phase, s.roundNo]);
  useEffect(() => { setOrder(null); }, [s.roundNo]);

  // Sound cues for server-driven phase changes.
  const prevPhase = useRef<Phase | null>(null);
  useEffect(() => {
    if (prevPhase.current === phase) return;
    const first = prevPhase.current === null;
    prevPhase.current = phase;
    if (first) return;
    if (phase === 'police_confirm') sfx('hand');
    else if (phase === 'discussion') sfx('confirm');
    else if (phase === 'investigation' || phase === 'fallback') sfx('alert');
    else if (phase === 'result' && result) sfx(result.outcome === 'police_correct' ? 'win' : 'lose');
  }, [phase, result]);

  async function act(event: string, payload?: object) {
    if (busy) return;
    setBusy(true);
    const res = await g.call(event, payload);
    setBusy(false);
    if (res.ok) { if (event === 'round:raiseHand') sfx('hand'); else if (event !== 'match:advance' && event !== 'round:skipVote') sfx('submit'); }
  }

  const showReveal = !!myRole && (seenRound !== s.roundNo || peek) && phase !== 'result';
  const total = phase === 'discussion' ? s.settings.discussionMs
    : phase === 'investigation' ? s.settings.investigationMs : s.settings.fallbackMs;
  const others = s.players.filter((p) => p.id !== g.myId);
  const chatOpen = phase === 'discussion' || phase === 'result';
  const iAmOfficer = myRole === 'officer';
  const iAmPolice = myRole === 'police';
  const choosing = (phase === 'investigation' && iAmPolice) || (phase === 'fallback' && iAmOfficer);

  const officerId = Object.keys(verified).find((id) => verified[id] === 'officer');
  const policeId = Object.keys(verified).find((id) => verified[id] === 'police');
  const nameOf = (id?: string | null) => s.players.find((p) => p.id === id)?.name ?? 'Someone';

  return (
    <main className="match">
      {showReveal && myRole && (
        <RoleReveal role={myRole} roundNo={s.roundNo} totalRounds={s.settings.rounds}
          skipIntro={peek || s.roundNo === skipRound.current}
          onClose={() => { setSeenRound(s.roundNo); setPeek(false); }} />
      )}

      <div className="match-board">
        <header className="card match-head">
          <div className="match-head-top">
            <span className="round-chip">Round {s.roundNo} / {s.settings.rounds}</span>
            <span className="phase-label">{PHASE_LABEL[phase]}</span>
            <PrefsBar />
          </div>
          {phase !== 'result' && <Timer s={s} total={total} />}
          <div className="match-head-row">
            {myRole ? (
              <button className="role-peek" onClick={() => setPeek(true)} aria-label={`Your secret role is ${ROLE_INFO[myRole].name}. Show details`}>
                <Eye size={16} aria-hidden="true" /> You are: <RoleBadge role={myRole} size="sm" />
              </button>
            ) : <span className="hint">Loading your role…</span>}
            <span className="objective"><Crosshair size={14} aria-hidden="true" />{' '}
              {orderNow ? <>Officer's order: find the <b>{target}</b></> : 'Waiting for the Officer\'s order'}</span>
          </div>
        </header>

        <PauseBanner s={s} />

        <div className="sr-only" role="status" aria-live="assertive">
          {PHASE_LABEL[phase]}.{officerId ? ` ${nameOf(officerId)} is the verified Officer.` : ''}{policeId ? ` ${nameOf(policeId)} is the verified Police.` : ''}
        </div>

        <ul className="pgrid" aria-label="Players">
          {s.players.map((p) => {
            const prev = p.score - (result?.deltas[p.id] ?? 0);
            return (
              <PlayerCard key={p.id} player={p} isMe={p.id === g.myId}
                verified={verified[p.id]} revealed={result?.roles[p.id]}
                roundDelta={result?.deltas[p.id]} prevScore={result ? prev : undefined}
                isTarget={!!result && result.target === p.id}
                selectable={choosing && p.id !== g.myId && !busy}
                selected={pick === p.id} onSelect={() => setPick(p.id)} />
            );
          })}
        </ul>

        <section className="card action-panel" aria-label="Your action">
          {phase === 'officer_call' && (iAmOfficer ? (
            <>
              <p className="action-title">You are the Officer. Give your order!</p>
              <div className="order-pick" role="radiogroup" aria-label="Who must the Police find?">
                {(['chor', 'daket'] as const).map((o) => (
                  <button key={o} role="radio" aria-checked={order === o} disabled={busy}
                    className={`order-opt order-${o}${order === o ? ' on' : ''}`} onClick={() => setOrder(o)}>
                    <Search size={20} aria-hidden="true" /> Find the {ORDER_NAME[o]}
                  </button>
                ))}
              </div>
              <button className="btn btn-primary btn-big btn-hand" disabled={busy || !order} aria-busy={busy}
                onClick={() => order && void act('round:raiseHand', { order })}>
                <Hand aria-hidden="true" /> {order ? `Raise my hand: find the ${ORDER_NAME[order]}` : 'Choose an order first'}
              </button>
              <p className="hint">Everyone will see that you are the Officer, and what you ordered.</p>
            </>
          ) : (
            <p className="waiting"><Hourglass size={18} aria-hidden="true" /> Waiting for the Officer to raise a hand…</p>
          ))}

          {phase === 'police_confirm' && (iAmPolice ? (
            <>
              <p className="action-title">The Officer needs you, Police!</p>
              <p className="order-banner"><Search size={18} aria-hidden="true" /> Order from {nameOf(officerId)}: find the <b>{target}</b></p>
              <button className="btn btn-sky btn-big btn-hand" disabled={busy} aria-busy={busy}
                onClick={() => void act('round:raiseHand')}>
                <Hand aria-hidden="true" /> Raise my hand
              </button>
              <p className="hint">This starts the discussion timer.</p>
            </>
          ) : (
            <p className="waiting"><Hourglass size={18} aria-hidden="true" /> {nameOf(officerId)} is the Officer and ordered: find the {target}. Waiting for the Police to raise a hand…</p>
          ))}

          {phase === 'discussion' && (
            <>
              <p className="action-title">Discuss! Who is the {target}?</p>
              <p className="hint">
                {iAmPolice ? 'Ask questions. Not everyone is honest.'
                  : iAmOfficer ? 'Guide the Police with what you know.'
                  : myRole === 'chor' ? 'Bluff! Do not get caught. Anything you type is just a claim.'
                  : 'Bluff! Anything you type is just a claim. Only verified hands are real.'}
              </p>
              <button className={`btn btn-skip ${iVotedSkip ? 'btn-mint' : 'btn-ghost'}`} disabled={busy} aria-pressed={iVotedSkip}
                onClick={() => void act('round:skipVote', { vote: !iVotedSkip })}>
                <SkipForward aria-hidden="true" /> {iVotedSkip ? 'You voted to skip (tap to undo)' : 'Vote to skip discussion'}
                <span className="skip-count">{skipVotes.length}/{round?.skipNeeded ?? 3}</span>
              </button>
              <p className="hint" role="status">
                {skipVotes.length ? `Voted to skip: ${skipVotes.map((id) => nameOf(id)).join(', ')}. ` : ''}
                {round?.skipNeeded ?? 3} votes end the discussion early.
              </p>
            </>
          )}

          {phase === 'investigation' && (iAmPolice ? (
            <Accuse title={`Who is the ${target}?`} cta="Accuse" pick={pick} busy={busy}
              pickName={nameOf(pick)} onConfirm={() => pick && void act('investigation:submit', { targetId: pick })} />
          ) : (
            <p className="waiting"><Hourglass size={18} aria-hidden="true" /> {nameOf(policeId)} (Police) is choosing the Chor…</p>
          ))}

          {phase === 'fallback' && (
            <>
              <p className="timeout-note">The Police ran out of time and loses 20 points.</p>
              {iAmOfficer ? (
                <Accuse title={`Your fallback guess: who is the ${target}?`} cta="Make my guess" pick={pick} busy={busy}
                  pickName={nameOf(pick)}
                  onConfirm={() => pick && void act('officer:fallbackSubmit', { targetId: pick })} />
              ) : (
                <p className="waiting"><Hourglass size={18} aria-hidden="true" /> {nameOf(officerId)} (Officer) gets one fallback guess…</p>
              )}
            </>
          )}

          {phase === 'result' && result && (
            <RoundResultPanel s={s} result={result} isHost={isHost} busy={busy}
              onNext={() => void act('match:advance')} />
          )}
        </section>

        <button className="btn btn-ghost leave" onClick={async () => {
          const yes = await g.ask({
            title: 'Leave the match?',
            message: 'If you leave now, the match ends for all four players.',
            confirmText: 'Leave match', cancelText: 'Stay', tone: 'danger',
          });
          if (yes) void g.leaveRoom();
        }}>
          <LogOut size={18} aria-hidden="true" /> Leave match
        </button>
      </div>

      <aside className="match-chat">
        <Chat messages={g.chat} players={s.players} myId={g.myId}
          onSend={async (text) => (await g.call('chat:send', { text })).ok}
          disabled={!chatOpen}
          disabledText={phase === 'discussion' || phase === 'result' ? undefined : 'Chat opens during the discussion'} />
      </aside>
    </main>
  );
}

function Accuse({ title, cta, pick, pickName, busy, onConfirm }: {
  title: string; cta: string; pick: string | null; pickName: string; busy: boolean; onConfirm: () => void;
}) {
  return (
    <>
      <p className="action-title">{title}</p>
      <p className="hint">Tap a player card above, then confirm. You cannot change it after.</p>
      <button className="btn btn-coral btn-big" disabled={!pick || busy} aria-busy={busy} onClick={onConfirm}>
        <Crosshair aria-hidden="true" /> {pick ? `${cta}: ${pickName}` : 'Pick a player first'}
      </button>
    </>
  );
}
