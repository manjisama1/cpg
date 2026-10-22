import { Crown, LogOut, RotateCcw, WifiOff } from 'lucide-react';
import { useGame } from '../game';
import { Chat } from '../components/Chat';
import { Confetti } from '../components/Confetti';
import { RoleBadge } from '../components/RoleArt';
import { signed } from '../components/AnimatedNumber';
import { useReducedMotion } from '../prefs';
import { sfx } from '../sound';
import { useEffect } from 'react';
import '../match.css';

export function FinalScreen() {
  const g = useGame();
  const s = g.state!;
  const reduced = useReducedMotion();
  const rows = s.final ?? [];
  const winners = rows.filter((r) => r.rank === 1);
  const isHost = s.hostId === g.myId;
  const rounds = rows[0]?.perRound.length ?? 0;

  useEffect(() => { sfx('final'); }, []);

  return (
    <main className="final">
      {!reduced && <Confetti />}
      <header className="final-head">
        <h1 className="final-title">Match over!</h1>
        <p className="final-winner" role="status">
          <Crown aria-hidden="true" />{' '}
          {winners.length > 1 ? `Tie for first: ${winners.map((w) => w.name).join(' and ')}` : `${winners[0]?.name ?? 'Nobody'} wins!`}
        </p>
      </header>

      <section className="card" aria-label="Final ranking">
        <ol className="rank-list">
          {rows.map((r) => (
            <li key={r.playerId} className={`rank-row${r.rank === 1 ? ' first' : ''}`}>
              <span className="rank-no" aria-label={`Rank ${r.rank}${rows.filter((o) => o.rank === r.rank).length > 1 ? ' (tied)' : ''}`}>#{r.rank}</span>
              <span className="rank-name">{r.name}{r.playerId === g.myId ? ' (you)' : ''}</span>
              <span className="rank-stats">{r.correct} right, {r.wrong} wrong, {r.timeouts} timeouts as Police</span>
              <b className="rank-total">{r.total} pts</b>
            </li>
          ))}
        </ol>
        <p className="hint">Equal scores share a rank. There is no hidden tie-breaker.</p>
      </section>

      <section className="card" aria-label="Round by round">
        <h2>Round by round</h2>
        <div className="table-scroll">
          <table className="rounds-table">
            <caption className="sr-only">Points and roles for every round</caption>
            <thead>
              <tr><th scope="col">Player</th>{Array.from({ length: rounds }, (_, i) => <th scope="col" key={i}>R{i + 1}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId}>
                  <th scope="row">{r.name}</th>
                  {r.perRound.map((d, i) => (
                    <td key={i}>
                      <RoleBadge role={r.roles[i]} size="sm" />
                      <b className={`delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{signed(d)}</b>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="final-actions">
        {isHost ? (
          <button className="btn btn-primary btn-big" onClick={() => void g.call('match:restart')}>
            <RotateCcw aria-hidden="true" /> Rematch (back to lobby)
          </button>
        ) : <p className="hint">Waiting for the host to start a rematch…</p>}
        <button className="btn btn-ghost" onClick={() => void g.leaveRoom()}><LogOut size={18} aria-hidden="true" /> Leave room</button>
      </div>

      <div className="final-chat"><Chat messages={g.chat} players={s.players} myId={g.myId}
        onSend={async (text) => (await g.call('chat:send', { text })).ok} /></div>
    </main>
  );
}

export function AbortedScreen() {
  const g = useGame();
  const s = g.state!;
  const isHost = s.hostId === g.myId;
  return (
    <main className="home">
      <section className="card home-card">
        <h2><WifiOff aria-hidden="true" /> Match ended</h2>
        <p>The match ended early (a player left or did not reconnect in time), so no winner is declared.</p>
        <ul className="plain-list">
          {s.players.map((p) => <li key={p.id}>{p.name}: {p.score} pts{p.connected ? '' : ' (offline)'}</li>)}
        </ul>
        {isHost
          ? <button className="btn btn-primary" onClick={() => void g.call('match:restart')}>Back to lobby</button>
          : <p className="hint">Waiting for the host…</p>}
        <button className="btn btn-ghost" onClick={() => void g.leaveRoom()}><LogOut size={18} aria-hidden="true" /> Leave room</button>
      </section>
    </main>
  );
}
