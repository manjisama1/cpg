import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignRoles, Round, Scoreboard, scorePoliceDecision, scoreTimeout,
  DEFAULT_SETTINGS, ROLES, type Role,
} from '../src/engine.ts';

const P = ['a', 'b', 'c', 'd'];
const fixed: Record<string, Role> = { a: 'officer', b: 'police', c: 'daket', d: 'chor' };
const S = DEFAULT_SETTINGS;

test('assignRoles: one unique role per player', () => {
  const r = assignRoles(P);
  assert.deepEqual(Object.values(r).sort(), [...ROLES].sort());
  assert.throws(() => assignRoles(['a', 'b', 'c']));
  assert.throws(() => assignRoles(['a', 'a', 'b', 'c']));
});

test('assignRoles: all 24 permutations appear, roughly uniform', () => {
  const counts = new Map<string, number>();
  const N = 24_000;
  for (let i = 0; i < N; i++) {
    const r = assignRoles(P);
    const k = P.map((p) => r[p]).join();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.equal(counts.size, 24);
  for (const c of counts.values()) assert.ok(c > 700 && c < 1300, `count ${c} out of range`);
});

test('scoring: correct / wrong police decision', () => {
  // Police wins: Officer + Police gain, Daket + Chor lose.
  assert.deepEqual(scorePoliceDecision(fixed, 'd'), { a: 50, b: 30, c: -15, d: -10 });
  // Police wrong: Daket + Chor gain, Officer + Police lose.
  assert.deepEqual(scorePoliceDecision(fixed, 'c'), { a: -20, b: -15, c: 15, d: 10 });
  // Order 'daket': picking the Daket is correct, picking the Chor is wrong.
  assert.deepEqual(scorePoliceDecision(fixed, 'c', 'daket'), { a: 50, b: 30, c: -15, d: -10 });
  assert.deepEqual(scorePoliceDecision(fixed, 'd', 'daket'), { a: -20, b: -15, c: 15, d: 10 });
});

test('scoring: timeout and fallback outcomes', () => {
  assert.deepEqual(scoreTimeout(fixed, 'd'), { a: 10, b: -20, c: 0, d: 0 });
  assert.deepEqual(scoreTimeout(fixed, 'c'), { a: -30, b: -20, c: 0, d: 0 });
  assert.deepEqual(scoreTimeout(fixed, null), { a: 0, b: -20, c: 0, d: 0 });
});

function toInvestigation(r: Round, t0 = 0) {
  r.raiseHand('a', t0, 'chor');
  r.raiseHand('b', t0);
  r.tick(t0 + S.discussionMs);
}

test('hand raise: only real officer then real police, in order', () => {
  const r = new Round(P, S, fixed);
  assert.throws(() => r.raiseHand('b', 0)); // police too early
  assert.throws(() => r.raiseHand('d', 0)); // chor can't
  r.raiseHand('a', 0, 'chor');
  assert.throws(() => r.raiseHand('a', 0, 'chor')); // twice
  assert.throws(() => r.raiseHand('c', 0)); // daket can't
  r.raiseHand('b', 0);
  assert.equal(r.phase, 'discussion');
  assert.deepEqual(r.publicView().verified, { a: 'officer', b: 'police' });
});

test('public view hides roles until result', () => {
  const r = new Round(P, S, fixed);
  assert.equal(r.publicView().result, null);
  assert.ok(!JSON.stringify(r.publicView()).includes('chor'));
});

test('police investigation: validation and idempotence', () => {
  const r = new Round(P, S, fixed);
  r.raiseHand('a', 0, 'chor'); r.raiseHand('b', 0);
  assert.throws(() => r.submitInvestigation('b', 'd', 1000)); // still discussing
  r.tick(S.discussionMs);
  assert.equal(r.phase, 'investigation');
  assert.throws(() => r.submitInvestigation('c', 'd', S.discussionMs)); // not police
  assert.throws(() => r.submitInvestigation('b', 'b', S.discussionMs)); // self
  assert.throws(() => r.submitInvestigation('b', 'zzz', S.discussionMs));
  r.submitInvestigation('b', 'd', S.discussionMs + 1);
  assert.equal(r.result!.outcome, 'police_correct');
  assert.throws(() => r.submitInvestigation('b', 'c', S.discussionMs + 2)); // replay
});

test('police timeout -> officer fallback correct / wrong / missed', () => {
  const run = (target: string | null) => {
    const r = new Round(P, S, fixed);
    toInvestigation(r);
    const t = S.discussionMs + S.investigationMs;
    r.tick(t);
    assert.equal(r.phase, 'fallback');
    if (target) r.submitFallback('a', target, t + 1);
    else r.tick(t + S.fallbackMs);
    return r.result!;
  };
  assert.deepEqual(run('d').deltas, { a: 10, b: -20, c: 0, d: 0 });
  assert.deepEqual(run('c').deltas, { a: -30, b: -20, c: 0, d: 0 });
  const missed = run(null);
  assert.deepEqual(missed.deltas, { a: 0, b: -20, c: 0, d: 0 });
  assert.equal(missed.fallback, 'missed');
});

test('late police submission after deadline is rejected by server clock', () => {
  const r = new Round(P, S, fixed);
  toInvestigation(r);
  const late = S.discussionMs + S.investigationMs + 1;
  assert.throws(() => r.submitInvestigation('b', 'd', late));
  assert.equal(r.phase, 'fallback');
  assert.throws(() => r.submitFallback('b', 'd', late)); // police isn't officer
  assert.throws(() => r.submitFallback('a', 'a', late)); // officer can't pick self
});

test('scoreboard: cumulative, negative totals, duplicate round ignored', () => {
  const sb = new Scoreboard(P);
  assert.ok(sb.apply(1, scorePoliceDecision(fixed, 'c')));
  assert.ok(!sb.apply(1, scorePoliceDecision(fixed, 'd'))); // duplicate
  assert.ok(sb.apply(2, scoreTimeout(fixed, 'c')));
  // round 1 (wrong): -20,-15,+15,+10; round 2 (timeout, wrong fallback): -30,-20,0,0
  assert.deepEqual(sb.totals, { a: -50, b: -35, c: 15, d: 10 });
  assert.deepEqual(new Scoreboard(P).totals, { a: 0, b: 0, c: 0, d: 0 }); // restart
});

test('order: officer must choose chor or daket to raise their hand', () => {
  const r = new Round(P, S, fixed);
  assert.equal(r.publicView().order, null);
  assert.throws(() => r.raiseHand('a', 0)); // no order
  assert.throws(() => r.raiseHand('a', 0, 'police' as never)); // not a valid order
  assert.throws(() => r.raiseHand('a', 0, 'officer' as never));
  r.raiseHand('a', 0, 'daket');
  assert.equal(r.publicView().order, 'daket');
  r.raiseHand('b', 0); // police does not choose
  assert.equal(r.order, 'daket');
});

test('order daket: police finding the Daket wins; picking the Chor loses', () => {
  const run = (target: string) => {
    const r = new Round(P, S, fixed);
    r.raiseHand('a', 0, 'daket'); r.raiseHand('b', 0);
    r.tick(S.discussionMs);
    r.submitInvestigation('b', target, S.discussionMs + 1);
    return r.result!;
  };
  assert.equal(run('c').outcome, 'police_correct');
  assert.deepEqual(run('c').deltas, { a: 50, b: 30, c: -15, d: -10 });
  assert.equal(run('d').outcome, 'police_wrong');
  assert.deepEqual(run('d').deltas, { a: -20, b: -15, c: 15, d: 10 });
  assert.equal(run('c').order, 'daket');
});

test('order daket: officer fallback follows the same order', () => {
  const r = new Round(P, S, fixed);
  r.raiseHand('a', 0, 'daket'); r.raiseHand('b', 0);
  r.tick(S.discussionMs);
  const t = S.discussionMs + S.investigationMs;
  r.tick(t);
  r.submitFallback('a', 'c', t + 1); // the Daket: correct under this order
  assert.deepEqual(r.result!.deltas, { a: 10, b: -20, c: 0, d: 0 });
});

test('skip vote: 3 of 4 votes end the discussion early', () => {
  const r = new Round(P, S, fixed);
  assert.throws(() => r.voteSkip('c', true, 0)); // not in discussion yet
  r.raiseHand('a', 0, 'chor'); r.raiseHand('b', 0);
  assert.equal(r.voteSkip('a', true, 1000), false);
  assert.equal(r.voteSkip('a', true, 1100), false); // same player twice counts once
  assert.equal(r.voteSkip('c', true, 1200), false);
  assert.deepEqual(r.publicView().skipVotes.sort(), ['a', 'c']);
  assert.equal(r.phase, 'discussion');
  assert.equal(r.voteSkip('d', true, 5000), true);
  assert.equal(r.phase, 'investigation');
  assert.equal(r.deadline, 5000 + S.investigationMs); // fresh server deadline
  assert.throws(() => r.voteSkip('b', true, 5001)); // discussion is over
});

test('skip vote: votes can be withdrawn, strangers cannot vote, two votes are not enough', () => {
  const r = new Round(P, S, fixed);
  r.raiseHand('a', 0, 'chor'); r.raiseHand('b', 0);
  r.voteSkip('a', true, 10); r.voteSkip('b', true, 10);
  r.voteSkip('b', false, 20);
  assert.deepEqual(r.publicView().skipVotes, ['a']);
  assert.throws(() => r.voteSkip('zzz', true, 30));
  r.voteSkip('c', true, 30); r.voteSkip('d', true, 30); // a, c, d = 3
  assert.equal(r.phase, 'investigation');
});

test('skip vote: police can then investigate straight away', () => {
  const r = new Round(P, S, fixed);
  r.raiseHand('a', 0, 'chor'); r.raiseHand('b', 0);
  r.voteSkip('a', true, 100); r.voteSkip('c', true, 100); r.voteSkip('d', true, 100);
  r.submitInvestigation('b', 'd', 200);
  assert.equal(r.result!.outcome, 'police_correct');
});
