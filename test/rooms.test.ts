import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, GameError, CODE_ALPHABET, CODE_LENGTH, type Room, type Player } from '../src/rooms.ts';

function setup() {
  const m = new RoomManager();
  const { room, player: host } = m.createRoom('Ann', 's0', 0);
  const ps: Player[] = [host];
  ['Bob', 'Cy', 'Di'].forEach((n, i) => ps.push(m.join(room.code, { name: n }, `s${i + 1}`, 0).player));
  return { m, room, ps, host };
}
const readyAll = (m: RoomManager, room: Room, ps: Player[]) =>
  ps.forEach((p) => m.setReady(room.code, p.id, true, 0));
const byRole = (m: RoomManager, room: Room, ps: Player[], role: string) =>
  ps.find((p) => m.privateView(room, p.id).role === role)!;
const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof GameError ? e.code : `non-GameError: ${e}`; }
  return 'no error';
};
function started(rounds = 5) {
  const s = setup();
  s.m.updateSettings(s.room.code, s.host.id, { rounds }, 0);
  readyAll(s.m, s.room, s.ps);
  s.m.startMatch(s.room.code, s.host.id, 0);
  const r = (role: string) => byRole(s.m, s.room, s.ps, role);
  return { ...s, r };
}
const D = 60_000;

test('room codes: right length and alphabet, no confusing characters', () => {
  assert.ok(!/[O0I1]/.test(CODE_ALPHABET));
  const m = new RoomManager();
  const codes = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const { room } = m.createRoom(`P${i}`, `s${i}`, 0);
    assert.equal(room.code.length, CODE_LENGTH);
    assert.ok([...room.code].every((c) => CODE_ALPHABET.includes(c)));
    codes.add(room.code);
  }
  assert.equal(codes.size, 300);
});

test('lobby: four players, fifth rejected, duplicate names rejected, codes case-insensitive', () => {
  const { m, room } = setup();
  assert.equal(room.players.length, 4);
  assert.equal(code(() => m.join(room.code, { name: 'Eve' }, 's9', 0)), 'room_full');
  const m2 = new RoomManager();
  const r2 = m2.createRoom('Ann', 'a', 0).room;
  assert.equal(code(() => m2.join(r2.code.toLowerCase(), { name: 'ann' }, 'b', 0)), 'name_taken');
  assert.equal(code(() => m2.join('ZZZZZ', { name: 'X' }, 'b', 0)), 'room_not_found');
  assert.ok(m2.join(r2.code.toLowerCase(), { name: 'Bo' }, 'b', 0).player);
});

test('names and chat are sanitized', () => {
  const m = new RoomManager();
  const { room, player } = m.createRoom('  <b>Ann</b>\u202e  ', 's', 0);
  assert.equal(player.name, 'bAnn/b');
  assert.equal(code(() => m.createRoom('   ', 's', 0)), 'bad_name');
  const msg = m.addChat(room.code, player.id, '  hi\u0000 there\u200b  ', 0);
  assert.equal(msg.text, 'hi there');
  assert.equal(m.addChat(room.code, player.id, 'x'.repeat(999), 1000).text.length, 300);
});

test('ready is idempotent; only host starts; needs all four ready and connected', () => {
  const { m, room, ps, host } = setup();
  m.setReady(room.code, ps[1].id, true, 0);
  m.setReady(room.code, ps[1].id, true, 0); // twice is fine
  assert.equal(code(() => m.startMatch(room.code, ps[1].id, 0)), 'not_host');
  assert.equal(code(() => m.startMatch(room.code, host.id, 0)), 'not_ready');
  readyAll(m, room, ps);
  m.detach(room.code, 's2', 0);
  assert.equal(code(() => m.startMatch(room.code, host.id, 0)), 'not_connected');
  m.join(room.code, { token: ps[2].token }, 's2b', 1);
  m.startMatch(room.code, host.id, 1);
  assert.equal(room.state, 'playing');
  assert.equal(code(() => m.startMatch(room.code, host.id, 2)), 'wrong_state');
});

test('settings: host only, validated, locked after start', () => {
  const { m, room, ps, host } = setup();
  assert.equal(code(() => m.updateSettings(room.code, ps[1].id, { rounds: 3 }, 0)), 'not_host');
  assert.equal(code(() => m.updateSettings(room.code, host.id, { rounds: 11 }, 0)), 'bad_settings');
  assert.equal(code(() => m.updateSettings(room.code, host.id, { rounds: 0 }, 0)), 'bad_settings');
  assert.equal(code(() => m.updateSettings(room.code, host.id, { discussionMs: 12_345 }, 0)), 'bad_settings');
  assert.equal(room.settings.rounds, 5); // failed updates change nothing
  m.updateSettings(room.code, host.id, { rounds: 3, discussionMs: 90_000 }, 0);
  assert.equal(room.settings.rounds, 3);
  readyAll(m, room, ps);
  m.startMatch(room.code, host.id, 0);
  assert.equal(code(() => m.updateSettings(room.code, host.id, { rounds: 1 }, 0)), 'wrong_state');
});

test('kick: host only, lobby only, not self', () => {
  const { m, room, ps, host } = setup();
  assert.equal(code(() => m.kick(room.code, ps[1].id, ps[2].id, 0)), 'not_host');
  assert.equal(code(() => m.kick(room.code, host.id, host.id, 0)), 'bad_target');
  m.kick(room.code, host.id, ps[3].id, 0);
  assert.equal(room.players.length, 3);
});

test('host leaving the lobby transfers host; empty room is deleted', () => {
  const { m, room, ps, host } = setup();
  m.leave(room.code, host.id, 0);
  assert.equal(room.hostId, ps[1].id);
  for (const p of ps.slice(1)) m.leave(room.code, p.id, 0);
  assert.equal(m.rooms.size, 0);
});

test('roles are private: public view has no roles before result; hand raises verify', () => {
  const { m, room, r } = started();
  const pub = JSON.stringify(m.publicView(room, 0));
  assert.ok(!/officer|police|daket|chor/.test(pub.replace(/officer_call|police_confirm/g, '')));
  assert.deepEqual(room.players.map((p) => m.privateView(room, p.id).role).sort(), ['chor', 'daket', 'officer', 'police']);
  assert.equal(code(() => m.raiseHand(room.code, r('chor').id, 0)), 'illegal_action');
  assert.equal(code(() => m.raiseHand(room.code, r('police').id, 0)), 'illegal_action'); // too early
  m.raiseHand(room.code, r('officer').id, 1000, 'chor');
  m.raiseHand(room.code, r('police').id, 1000);
  assert.deepEqual(m.publicView(room, 0).round!.verified, {
    [r('officer').id]: 'officer', [r('police').id]: 'police',
  });
});

test('chat: closed outside discussion/result, fake claims stay plain chat, rate limited', () => {
  const { m, room, ps, r } = started();
  assert.equal(code(() => m.addChat(room.code, ps[0].id, 'hello', 0)), 'chat_closed');
  m.raiseHand(room.code, r('officer').id, 0, 'chor');
  m.raiseHand(room.code, r('police').id, 0);
  const lie = m.addChat(room.code, r('chor').id, "I'm the Police!", 100);
  assert.equal(lie.kind, 'chat');
  assert.ok(!(r('chor').id in m.publicView(room, 0).round!.verified));
  assert.equal(code(() => m.addChat(room.code, r('chor').id, 'again', 200)), 'rate_limited');
  assert.equal(m.addChat(room.code, r('chor').id, 'again', 700).kind, 'chat');
  m.tick(D); // discussion over -> investigation
  assert.equal(code(() => m.addChat(room.code, ps[0].id, 'late', D + 5000)), 'chat_closed');
});

test('correct police investigation scores once and cannot be replayed', () => {
  const { m, room, r } = started();
  m.raiseHand(room.code, r('officer').id, 0, 'chor');
  m.raiseHand(room.code, r('police').id, 0);
  assert.equal(code(() => m.submitInvestigation(room.code, r('police').id, r('chor').id, 1000)), 'illegal_action'); // still discussing
  m.tick(D);
  assert.equal(code(() => m.submitInvestigation(room.code, r('daket').id, r('chor').id, D)), 'illegal_action');
  m.submitInvestigation(room.code, r('police').id, r('chor').id, D + 1);
  const total = (role: string) => room.scoreboard.totals[r(role).id];
  assert.deepEqual([total('officer'), total('police'), total('daket'), total('chor')], [50, 30, -15, -10]);
  assert.equal(code(() => m.submitInvestigation(room.code, r('police').id, r('daket').id, D + 2)), 'illegal_action');
  m.tick(D + 100_000);
  assert.equal(total('officer'), 50); // unchanged
  assert.equal(room.rounds.length, 1);
});

test('police timeout then officer fallback (correct and wrong); late police action rejected', () => {
  for (const [pick, officerDelta] of [['chor', 10], ['daket', -30]] as const) {
    const { m, room, r } = started();
    m.raiseHand(room.code, r('officer').id, 1000, 'chor');
    m.raiseHand(room.code, r('police').id, 1000);
    m.tick(1000 + D); // -> investigation (30s)
    m.tick(1000 + D + 30_000); // -> fallback (15s)
    assert.equal(room.round!.phase, 'fallback');
    assert.equal(code(() => m.submitInvestigation(room.code, r('police').id, r('chor').id, 1000 + D + 30_001)), 'illegal_action');
    m.submitFallback(room.code, r('officer').id, r(pick).id, 1000 + D + 30_002);
    assert.equal(room.scoreboard.totals[r('police').id], -20);
    assert.equal(room.scoreboard.totals[r('officer').id], officerDelta);
  }
});

test('missed officer fallback: only the police penalty applies', () => {
  const { m, room, r } = started();
  m.raiseHand(room.code, r('officer').id, 0, 'chor');
  m.raiseHand(room.code, r('police').id, 0);
  m.tick(D);
  m.tick(D + 30_000);
  m.tick(D + 45_000);
  assert.equal(room.round!.phase, 'result');
  assert.equal(room.scoreboard.totals[r('police').id], -20);
  assert.equal(room.scoreboard.totals[r('officer').id], 0);
});

test('actions that arrive after a deadline still advance the phase (server clock decides)', () => {
  const { m, room, r } = started();
  m.raiseHand(room.code, r('officer').id, 0, 'chor');
  m.raiseHand(room.code, r('police').id, 0);
  // No ticks ran; the police submits after the investigation window has fully passed.
  m.tick(D); // discussion -> investigation
  assert.equal(code(() => m.submitInvestigation(room.code, r('police').id, r('chor').id, D + 31_000)), 'illegal_action');
  assert.equal(room.round!.phase, 'fallback');
  assert.ok(m.needsFlush(room)); // clients get told even though the action failed
});

test('multi-round: advance is host only, rounds accumulate, final screen with ties', () => {
  const { m, room, ps, host, r } = started(2);
  const play = (target: 'chor' | 'daket', t0: number) => {
    m.raiseHand(room.code, r('officer').id, t0, 'chor');
    m.raiseHand(room.code, r('police').id, t0);
    m.tick(t0 + D);
    m.submitInvestigation(room.code, r('police').id, r(target).id, t0 + D + 1);
  };
  assert.equal(code(() => m.advance(room.code, host.id, 0)), 'wrong_state');
  play('daket', 0);
  assert.equal(code(() => m.advance(room.code, ps.find((p) => p.id !== host.id)!.id, 0)), 'not_host');
  m.advance(room.code, host.id, D + 2);
  assert.equal(room.roundNo, 2);
  const roleNow = (id: string) => room.round!.roleOf(id)!;
  const police = ps.find((p) => roleNow(p.id) === 'police')!;
  const chor = ps.find((p) => roleNow(p.id) === 'chor')!;
  const officer = ps.find((p) => roleNow(p.id) === 'officer')!;
  const t0 = 200_000;
  m.raiseHand(room.code, officer.id, t0, 'chor');
  m.raiseHand(room.code, police.id, t0);
  m.tick(t0 + D);
  m.submitInvestigation(room.code, police.id, chor.id, t0 + D + 1);
  m.advance(room.code, host.id, t0 + D + 2);
  assert.equal(room.state, 'complete');
  const final = m.publicView(room, 0).final!;
  assert.equal(final.length, 4);
  assert.equal(final.reduce((a, b) => a + b.perRound.length, 0), 8);
  for (const row of final) assert.equal(row.total, row.perRound.reduce((a, b) => a + b, 0));
  assert.equal(final[0].rank, 1);
  assert.equal(final.filter((f) => f.correct).length + final.filter((f) => f.wrong).length, 2);
});

test('ties share a rank', () => {
  const { m, room, r } = started(1);
  m.raiseHand(room.code, r('officer').id, 0, 'chor');
  m.raiseHand(room.code, r('police').id, 0);
  m.tick(D);
  m.submitInvestigation(room.code, r('police').id, r('daket').id, D + 1); // wrong: Daket +15, Chor +10, Officer -20, Police -15
  m.advance(room.code, room.hostId, D + 2);
  assert.deepEqual(m.finalResults(room).map((x) => x.rank), [1, 2, 3, 4]);
  // force equal totals to check competition ranking (equal scores share a rank, no hidden tie-breaker)
  const ids = room.players.map((p) => p.id);
  [10, 10, -5, -5].forEach((v, i) => (room.scoreboard.totals[ids[i]] = v));
  assert.deepEqual(m.finalResults(room).map((x) => x.rank), [1, 1, 3, 3]);
});

test('restart gives a fresh match: zero scores, lobby, fresh round later', () => {
  const { m, room, ps, host, r } = started(1);
  assert.equal(code(() => m.restart(room.code, host.id, 0)), 'wrong_state');
  m.raiseHand(room.code, r('officer').id, 0, 'chor');
  m.raiseHand(room.code, r('police').id, 0);
  m.tick(D);
  m.submitInvestigation(room.code, r('police').id, r('chor').id, D + 1);
  m.advance(room.code, host.id, D + 2);
  assert.equal(code(() => m.restart(room.code, ps[1].id, 0)), 'not_host');
  m.restart(room.code, host.id, D + 3);
  assert.equal(room.state, 'lobby');
  assert.ok(m.publicView(room, 0).players.every((p) => p.score === 0 && !p.ready));
  readyAll(m, room, ps);
  m.startMatch(room.code, host.id, D + 4);
  assert.equal(room.roundNo, 1);
  assert.equal(room.rounds.length, 0);
});

test('reconnect keeps role, adds no duplicate, and does not reroll', () => {
  const { m, room, ps, r } = started();
  const police = r('police');
  const before = m.privateView(room, police.id).role;
  m.detach(room.code, police.socketId!, 10);
  const back = m.join(room.code, { token: police.token }, 'new-socket', 20);
  assert.equal(back.reconnected, true);
  assert.equal(room.players.length, 4);
  assert.equal(m.privateView(room, police.id).role, before);
  assert.equal(code(() => m.join(room.code, { name: 'Newbie' }, 'x', 30)), 'already_started');
  assert.equal(code(() => m.join(room.code, { token: 'not-a-real-token-0000000000' }, 'x', 30)), 'already_started');
  void ps;
});

test('a second tab with the same token displaces the first socket', () => {
  const { m, room, ps } = started();
  const res = m.join(room.code, { token: ps[1].token }, 'tab2', 5);
  assert.equal(res.replacedSocketId, 's1');
  assert.equal(room.players.length, 4);
  assert.equal(m.detach(room.code, 's1', 6), null); // old socket's disconnect is ignored
  assert.equal(ps[1].connected, true);
});

test('disconnect pauses the match; reconnect shifts the deadline, never resets it', () => {
  const { m, room, r } = started();
  m.raiseHand(room.code, r('officer').id, 1000, 'chor');
  m.raiseHand(room.code, r('police').id, 1000); // deadline 61000
  const police = r('daket');
  m.detach(room.code, police.socketId!, 5000);
  assert.ok(room.pausedAt === 5000);
  const chor = r('chor');
  m.tick(40_000);
  m.tick(64_000); // past the original deadline (61000) but paused, and inside the 60s grace
  assert.equal(room.round!.phase, 'discussion');
  assert.equal(code(() => m.addChat(room.code, chor.id, 'hi', 64_500)), 'no error'); // chat still works
  m.join(room.code, { token: police.token }, 'back', 64_900);
  assert.equal(room.pausedAt, null);
  assert.equal(room.round!.deadline, 61_000 + (64_900 - 5000));
  assert.equal(room.round!.phase, 'discussion');
});

test('disconnect past the grace period aborts the match without inventing a result', () => {
  const { m, room, r } = started();
  m.raiseHand(room.code, r('officer').id, 0, 'chor');
  const p = r('chor');
  const policeId = r('police').id;
  m.detach(room.code, p.socketId!, 5000);
  m.tick(5000 + room.settings.graceMs - 1);
  assert.equal(room.state, 'playing');
  m.tick(5000 + room.settings.graceMs);
  assert.equal(room.state, 'aborted');
  assert.equal(room.rounds.length, 0);
  assert.equal(code(() => m.raiseHand(room.code, policeId, 70_000)), 'wrong_state');
});

test('lobby: disconnected player stays visible, then is removed after grace; host transfers', () => {
  const { m, room, ps, host } = setup();
  m.detach(room.code, 's0', 0); // host drops
  assert.equal(m.publicView(room, 0).players[0].connected, false);
  m.tick(room.settings.graceMs);
  assert.equal(room.players.length, 3);
  assert.equal(room.hostId, ps[1].id);
  void host;
});

test('abandoned empty rooms expire', () => {
  const m = new RoomManager();
  const { room } = m.createRoom('Ann', 's', 0);
  m.detach(room.code, 's', 1000);
  const { deleted } = m.tick(1000 + 11 * 60_000);
  assert.deepEqual(deleted, [room.code]);
  assert.equal(code(() => m.get(room.code)), 'room_not_found');
});

test('public view never includes session tokens', () => {
  const { m, room, ps } = started();
  const json = JSON.stringify(m.publicView(room, 0));
  for (const p of ps) assert.ok(!json.includes(p.token));
});

test('order and skip vote through the room manager', () => {
  const { m, room, r } = started();
  const ids = room.players.map((p) => p.id);
  assert.equal(code(() => m.raiseHand(room.code, r('officer').id, 0)), 'illegal_action'); // officer must give an order
  assert.equal(code(() => m.voteSkip(room.code, ids[0], true, 0)), 'illegal_action'); // not in discussion
  m.raiseHand(room.code, r('officer').id, 0, 'daket');
  assert.equal(m.publicView(room, 0).round!.order, 'daket');
  assert.ok(room.chat.some((c) => c.kind === 'system' && c.text.includes('find the Daket')));
  m.raiseHand(room.code, r('police').id, 0);
  m.voteSkip(room.code, ids[0], true, 1000);
  m.voteSkip(room.code, ids[1], true, 1000);
  assert.equal(room.round!.phase, 'discussion');
  assert.deepEqual(m.publicView(room, 0).round!.skipVotes.length, 2);
  m.voteSkip(room.code, ids[2], true, 2000);
  assert.equal(room.round!.phase, 'investigation');
  // police picks the Daket: correct under this order
  m.submitInvestigation(room.code, r('police').id, r('daket').id, 2500);
  const total = (role: string) => room.scoreboard.totals[r(role).id];
  assert.deepEqual([total('officer'), total('police'), total('daket'), total('chor')], [50, 30, -15, -10]);
  assert.ok(room.chat.some((c) => c.text.includes('Daket!') && c.text.includes('Officer and Police win')));
});

test('skip vote does not work while paused or after the round is over', () => {
  const { m, room, r } = started();
  const id = room.players[0].id;
  m.raiseHand(room.code, r('officer').id, 0, 'chor');
  m.raiseHand(room.code, r('police').id, 0);
  m.detach(room.code, room.players[3].socketId!, 100);
  assert.equal(code(() => m.voteSkip(room.code, id, true, 200)), 'paused');
});

test('characters: unique per room, validated, auto-assigned when none is sent', () => {
  const m = new RoomManager();
  const { room, player: host } = m.createRoom('Ann', 'a', 0, 3);
  assert.equal(host.character, 3);
  assert.equal(code(() => m.join(room.code, { name: 'Bob', character: 3 }, 'b', 0)), 'character_taken');
  assert.equal(code(() => m.join(room.code, { name: 'Bob', character: 10 }, 'b', 0)), 'bad_character');
  assert.equal(code(() => m.join(room.code, { name: 'Bob', character: -1 }, 'b', 0)), 'bad_character');
  assert.equal(m.join(room.code, { name: 'Bob', character: 7 }, 'b', 0).player.character, 7);
  // no pick sent: first free look (0 is free, 3 and 7 are not)
  assert.equal(m.join(room.code, { name: 'Cy' }, 'c', 0).player.character, 0);
  assert.equal(code(() => m.createRoom('Dee', 'd', 0, 99)), 'bad_character');
  // the public view carries the character, but never a token
  const view = m.publicView(room, 0);
  assert.deepEqual(view.players.map((p) => p.character), [3, 7, 0]);
  assert.ok(!JSON.stringify(view).includes(host.token));
});

test('characters: a rejected join does not take a seat, and a freed character can be reused', () => {
  const m = new RoomManager();
  const { room, player: host } = m.createRoom('Ann', 'a', 0, 1);
  assert.equal(code(() => m.join(room.code, { name: 'ann', character: 2 }, 'b', 0)), 'name_taken');
  assert.equal(code(() => m.join(room.code, { name: 'Bob', character: 1 }, 'b', 0)), 'character_taken');
  assert.equal(room.players.length, 1);
  const bob = m.join(room.code, { name: 'Bob', character: 2 }, 'b', 0).player;
  m.leave(room.code, bob.id, 1);
  assert.equal(m.join(room.code, { name: 'Bea', character: 2 }, 'c', 2).player.character, 2);
  // reconnecting with a token keeps the same character
  const again = m.join(room.code, { token: host.token }, 'a2', 3);
  assert.equal(again.player.character, 1);
});

test('peek: reports taken names and characters without leaking tokens', () => {
  const m = new RoomManager();
  const { room, player } = m.createRoom('Ann', 'a', 0, 4);
  const p = m.peek(room.code.toLowerCase());
  assert.deepEqual(p.takenCharacters, [4]);
  assert.deepEqual(p.takenNames, ['Ann']);
  assert.equal(p.open, true);
  assert.ok(!JSON.stringify(p).includes(player.token));
  assert.equal(code(() => m.peek('ZZZZZ')), 'room_not_found');
});
