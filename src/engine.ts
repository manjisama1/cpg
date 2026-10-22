import { randomInt } from 'node:crypto';

export type Role = 'officer' | 'police' | 'daket' | 'chor';
export const ROLES: readonly Role[] = ['officer', 'police', 'daket', 'chor'];
export type Order = 'chor' | 'daket'; // what the Officer tells the Police to find
export const ORDERS: readonly Order[] = ['chor', 'daket'];
export const SKIP_VOTES_NEEDED = 3; // votes (out of 4 players) that end the discussion early
export type Phase =
  | 'officer_call' | 'police_confirm' | 'discussion'
  | 'investigation' | 'fallback' | 'result';

export interface Settings {
  discussionMs: number;
  investigationMs: number;
  fallbackMs: number;
}
export const DEFAULT_SETTINGS: Settings = { discussionMs: 60_000, investigationMs: 30_000, fallbackMs: 15_000 };
export const ALLOWED_DISCUSSION_MS = [30_000, 45_000, 60_000, 90_000, 120_000];

export function validateSettings(s: Settings): Settings {
  if (!ALLOWED_DISCUSSION_MS.includes(s.discussionMs)) throw new Error('bad discussion duration');
  for (const k of ['investigationMs', 'fallbackMs'] as const) {
    if (!Number.isInteger(s[k]) || s[k] < 5_000 || s[k] > 120_000) throw new Error(`bad ${k}`);
  }
  return { ...s };
}

export type RandInt = (maxExclusive: number) => number;
const secureInt: RandInt = (n) => randomInt(n);

/** Unbiased Fisher-Yates using crypto.randomInt. Maps shuffled roles to players. */
export function assignRoles(playerIds: string[], rand: RandInt = secureInt): Record<string, Role> {
  if (playerIds.length !== 4 || new Set(playerIds).size !== 4) throw new Error('need exactly 4 unique players');
  const roles = [...ROLES];
  for (let i = roles.length - 1; i > 0; i--) {
    const j = rand(i + 1); // uniform in [0, i]
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  const out: Record<string, Role> = {};
  playerIds.forEach((id, i) => (out[id] = roles[i]));
  return out;
}

export type Deltas = Record<string, number>;

// Police found the ordered target: Officer + Police win, Daket + Chor lose.
const CORRECT: Record<Role, number> = { officer: 50, police: 30, daket: -15, chor: -10 };
// Police missed: Daket + Chor win, Officer + Police lose.
const WRONG: Record<Role, number> = { officer: -20, police: -15, daket: 15, chor: 10 };
const POLICE_TIMEOUT = -20, FALLBACK_OK = 10, FALLBACK_BAD = -30;

/** The "correct" target is whichever role the Officer ordered the Police to find. */
export const isCorrectTarget = (roles: Record<string, Role>, target: string, order: Order = 'chor') => roles[target] === order;

export function scorePoliceDecision(roles: Record<string, Role>, target: string, order: Order = 'chor'): Deltas {
  const table = isCorrectTarget(roles, target, order) ? CORRECT : WRONG;
  return Object.fromEntries(Object.entries(roles).map(([id, r]) => [id, table[r]]));
}

export function scoreTimeout(
  roles: Record<string, Role>,
  fallbackTarget: string | null,
  order: Order = 'chor',
): Deltas {
  const d: Deltas = Object.fromEntries(Object.keys(roles).map((id) => [id, 0]));
  const find = (r: Role) => Object.keys(roles).find((id) => roles[id] === r)!;
  d[find('police')] = POLICE_TIMEOUT;
  if (fallbackTarget !== null) d[find('officer')] = isCorrectTarget(roles, fallbackTarget, order) ? FALLBACK_OK : FALLBACK_BAD;
  return d;
}

export interface RoundResult {
  deltas: Deltas;
  outcome: 'police_correct' | 'police_wrong' | 'police_timeout';
  target: string | null;
  order: Order;
  fallback: 'correct' | 'wrong' | 'missed' | null;
  roles: Record<string, Role>; // only exposed after the round ends
}

export class Round {
  phase: Phase = 'officer_call';
  deadline: number | null = null;
  raised = new Set<Role>();
  order: Order | null = null; // set by the Officer's hand raise, public from then on
  skipVotes = new Set<string>();
  result: RoundResult | null = null;
  private roles: Record<string, Role>;
  private policeTarget: string | null = null;

  private settings: Settings;
  constructor(playerIds: string[], settings: Settings, roles?: Record<string, Role>) {
    this.settings = settings;
    this.roles = roles ?? assignRoles(playerIds);
  }

  private idOf(r: Role) { return Object.keys(this.roles).find((i) => this.roles[i] === r)!; }
  /** Private: only call with the caller's own id. */
  roleOf(playerId: string): Role | undefined { return this.roles[playerId]; }

  /** Public view; roles appear only once the round is over (plus verified hand-raisers). */
  publicView() {
    return {
      phase: this.phase,
      deadline: this.deadline,
      verified: Object.fromEntries([...this.raised].map((r) => [this.idOf(r), r])),
      order: this.order,
      skipVotes: [...this.skipVotes],
      skipNeeded: SKIP_VOTES_NEEDED,
      result: this.result,
    };
  }

  raiseHand(playerId: string, now: number, order?: Order): void {
    const role = this.roles[playerId];
    if (this.phase === 'officer_call' && role === 'officer') {
      if (!order || !ORDERS.includes(order)) throw new Error('Choose what the Police must find');
      this.order = order;
      this.raised.add('officer');
      this.phase = 'police_confirm';
    } else if (this.phase === 'police_confirm' && role === 'police') {
      this.raised.add('police');
      this.phase = 'discussion';
      this.deadline = now + this.settings.discussionMs; // set once, server-side
    } else throw new Error('illegal hand raise');
  }

  /** A player votes (or un-votes) to skip the discussion. Returns true if this vote ended it. */
  voteSkip(playerId: string, vote: boolean, now: number): boolean {
    this.tick(now);
    if (this.phase !== 'discussion') throw new Error('There is no discussion to skip');
    if (!(playerId in this.roles)) throw new Error('not allowed');
    if (vote) this.skipVotes.add(playerId); else this.skipVotes.delete(playerId);
    if (this.skipVotes.size < SKIP_VOTES_NEEDED) return false;
    this.phase = 'investigation';
    this.deadline = now + this.settings.investigationMs;
    return true;
  }

  /** Advance on server clock. Safe to call repeatedly. */
  tick(now: number): void {
    if (this.deadline === null || now < this.deadline) return;
    if (this.phase === 'discussion') {
      this.phase = 'investigation';
      this.deadline = now + this.settings.investigationMs;
    } else if (this.phase === 'investigation') {
      this.phase = 'fallback';
      this.deadline = now + this.settings.fallbackMs;
    } else if (this.phase === 'fallback') {
      this.finish(scoreTimeout(this.roles, null, this.order ?? 'chor'), 'police_timeout', null, 'missed');
    }
  }

  private checkTarget(actorRole: Role, actor: string, target: string) {
    if (this.roles[actor] !== actorRole) throw new Error('not allowed');
    if (!(target in this.roles) || target === actor) throw new Error('invalid target');
  }

  submitInvestigation(actor: string, target: string, now: number): void {
    this.tick(now);
    if (this.phase !== 'investigation') throw new Error('wrong phase');
    this.checkTarget('police', actor, target);
    const order = this.order ?? 'chor';
    const ok = isCorrectTarget(this.roles, target, order);
    this.finish(scorePoliceDecision(this.roles, target, order), ok ? 'police_correct' : 'police_wrong', target, null);
  }

  submitFallback(actor: string, target: string, now: number): void {
    this.tick(now);
    if (this.phase !== 'fallback') throw new Error('wrong phase');
    this.checkTarget('officer', actor, target);
    const order = this.order ?? 'chor';
    const ok = isCorrectTarget(this.roles, target, order);
    this.finish(scoreTimeout(this.roles, target, order), 'police_timeout', target, ok ? 'correct' : 'wrong');
  }

  private finish(deltas: Deltas, outcome: RoundResult['outcome'], target: string | null, fallback: RoundResult['fallback']) {
    if (this.result) return; // idempotent: score applies exactly once
    this.result = { deltas, outcome, target, order: this.order ?? 'chor', fallback, roles: { ...this.roles } };
    this.phase = 'result';
    this.deadline = null;
  }
}

/** Cumulative scoring. Each round id applies once. */
export class Scoreboard {
  totals: Record<string, number>;
  history: { round: number; deltas: Deltas }[] = [];
  constructor(playerIds: string[]) {
    this.totals = Object.fromEntries(playerIds.map((i) => [i, 0]));
  }
  apply(round: number, deltas: Deltas): boolean {
    if (this.history.some((h) => h.round === round)) return false;
    for (const [id, d] of Object.entries(deltas)) this.totals[id] += d;
    this.history.push({ round, deltas });
    return true;
  }
}
