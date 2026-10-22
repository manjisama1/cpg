import { ArrowRight, Trophy } from 'lucide-react';
import type { PublicState, RoundResult } from '../types';
import { Confetti } from '../components/Confetti';
import { ROLE_INFO } from '../components/RoleArt';
import { signed } from '../components/AnimatedNumber';
import { useReducedMotion } from '../prefs';

export function RoundResultPanel({ s, result, isHost, busy, onNext }: {
  s: PublicState; result: RoundResult; isHost: boolean; busy: boolean; onNext: () => void;
}) {
  const reduced = useReducedMotion();
  const nameOf = (id: string | null) => s.players.find((p) => p.id === id)?.name ?? 'Someone';
  const targetRole = result.target ? ROLE_INFO[result.roles[result.target]].name : null;
  const last = s.roundNo >= s.settings.rounds;

  let headline = '';
  let detail = '';
  const want = result.order === 'daket' ? 'Daket' : 'Chor';
  let winners = '';
  if (result.outcome === 'police_correct') {
    headline = `The Police found the ${want}!`;
    detail = `${nameOf(result.target)} was the ${want}.`;
    winners = 'Officer and Police win this round.';
  } else if (result.outcome === 'police_wrong') {
    headline = 'Wrong guess!';
    detail = `${nameOf(result.target)} was the ${targetRole}, not the ${want}.`;
    winners = 'Daket and Chor win this round.';
  } else {
    headline = 'The Police ran out of time.';
    detail = result.fallback === 'correct' ? `The Officer guessed ${nameOf(result.target)} and found the ${want}!`
      : result.fallback === 'wrong' ? `The Officer guessed ${nameOf(result.target)}, but they were the ${targetRole}.`
      : 'The Officer did not guess in time either.';
  }

  return (
    <div className={`result result-${result.outcome}`}>
      {result.outcome === 'police_correct' && !reduced && <Confetti />}
      <h2 className="result-head">{headline}</h2>
      <p className="result-detail" role="status">{detail}</p>
      {winners && <p className="result-winners">{winners}</p>}
      <ul className="result-rows">
        {s.players.map((p) => {
          const d = result.deltas[p.id] ?? 0;
          return (
            <li key={p.id}>
              <span>{p.name}</span>
              <span className="result-role">{ROLE_INFO[result.roles[p.id]].name}</span>
              <b className={`delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{signed(d)}</b>
            </li>
          );
        })}
      </ul>
      {isHost ? (
        <button className="btn btn-primary btn-big" disabled={busy} onClick={onNext}>
          {last ? <><Trophy aria-hidden="true" /> See final results</> : <>Next round <ArrowRight aria-hidden="true" /></>}
        </button>
      ) : (
        <p className="hint">Waiting for the host to continue…</p>
      )}
    </div>
  );
}
