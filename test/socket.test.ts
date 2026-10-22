import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect, type Socket } from 'socket.io-client';
import { createGameServer } from '../src/app.ts';

const server = createGameServer({ tickMs: 50, joinLimitPerMinute: 10_000 });
let url = '';
const open: Client[] = [];

before(async () => {
  url = `http://localhost:${await server.listen(0)}`;
});
after(async () => {
  open.forEach((c) => c.sock.disconnect());
  await server.close();
});

type Ack = { ok: boolean; error?: { code: string; message: string }; [k: string]: any };

/** A fake player: tracks everything the server tells it. */
class Client {
  sock: Socket;
  state: any = null;
  priv: any = null;
  chat: any[] = [];
  playerId = '';
  token = '';
  rawEvents: string[] = [];

  constructor() {
    this.sock = connect(url, { transports: ['websocket'], forceNew: true });
    this.sock.on('room:state', (s) => { this.state = s; this.rawEvents.push(JSON.stringify(s)); });
    this.sock.on('player:private', (p) => (this.priv = p));
    this.sock.on('chat:history', (h) => (this.chat = [...h]));
    this.sock.on('chat:message', (m) => this.chat.push(m));
    open.push(this);
  }
  async send(event: string, payload: unknown = {}): Promise<Ack> {
    return this.sock.emitWithAck(event, payload);
  }
  async until(cond: () => boolean, label = 'condition', ms = 3000) {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

async function lobby(names = ['Ann', 'Bob', 'Cy', 'Di']) {
  const clients = names.map(() => new Client());
  const created = await clients[0].send('room:create', { name: names[0] });
  assert.ok(created.ok, JSON.stringify(created));
  const roomCode: string = created.code;
  clients[0].playerId = created.playerId;
  clients[0].token = created.token;
  for (let i = 1; i < clients.length; i++) {
    const res = await clients[i].send('room:join', { code: roomCode, name: names[i] });
    assert.ok(res.ok, JSON.stringify(res));
    clients[i].playerId = res.playerId;
    clients[i].token = res.token;
  }
  return { clients, roomCode };
}
async function started() {
  const l = await lobby();
  for (const c of l.clients) assert.ok((await c.send('lobby:ready', { ready: true })).ok);
  assert.ok((await l.clients[0].send('match:start')).ok);
  await Promise.all(l.clients.map((c) => c.until(() => c.priv?.role, 'private role')));
  const by = (role: string) => l.clients.find((c) => c.priv.role === role)!;
  return { ...l, by };
}

test('four players join and see the same synchronized lobby; fifth is rejected', async () => {
  const { clients, roomCode } = await lobby();
  await Promise.all(clients.map((c) => c.until(() => c.state?.players.length === 4, '4 players')));
  const fifth = new Client();
  const res = await fifth.send('room:join', { code: roomCode, name: 'Eve' });
  assert.equal(res.ok, false);
  assert.equal(res.error!.code, 'room_full');
  const bad = await fifth.send('room:join', { code: 'ZZZZZ', name: 'Eve' });
  assert.equal(bad.error!.code, 'room_not_found');
  await clients[1].send('lobby:ready', { ready: true });
  await Promise.all(clients.map((c) => c.until(() => c.state.players[1].ready === true, 'ready sync')));
});

test('only the host can start; all four must be ready', async () => {
  const { clients } = await lobby();
  assert.equal((await clients[1].send('match:start')).error!.code, 'not_host');
  assert.equal((await clients[0].send('match:start')).error!.code, 'not_ready');
  assert.equal((await clients[1].send('lobby:updateSettings', { rounds: 2 })).error!.code, 'not_host');
  assert.ok((await clients[0].send('lobby:updateSettings', { rounds: 2 })).ok);
  assert.equal((await clients[0].send('lobby:updateSettings', { rounds: 99 })).error!.code, 'bad_settings');
});

test('malformed payloads are rejected without crashing the server', async () => {
  const c = new Client();
  assert.equal((await c.send('room:create', { name: 42 })).error!.code, 'bad_payload');
  assert.equal((await c.send('room:create', { name: 'A', isHost: true })).error!.code, 'bad_payload'); // unknown keys refused
  assert.equal((await c.send('chat:send', { text: 'hi' })).error!.code, 'no_session');
  assert.equal((await c.send('round:raiseHand', null)).error!.code, 'no_session');
});

test('roles are unique, private, and never appear in public state', async () => {
  const { clients } = await started();
  assert.deepEqual(clients.map((c) => c.priv.role).sort(), ['chor', 'daket', 'officer', 'police']);
  for (const c of clients) {
    for (const raw of c.rawEvents) {
      // Only phase names may contain these words before anyone has raised a hand.
      const cleaned = raw.replace(/officer_call|police_confirm/g, '');
      assert.ok(!/"(officer|police|daket|chor)"/.test(cleaned), `public state leaked a role: ${cleaned}`);
    }
  }
});

test('official hand raises are public; a fake police claim in chat changes nothing', async () => {
  const { clients, by } = await started();
  const chor = by('chor');
  assert.equal((await chor.send('round:raiseHand')).error!.code, 'illegal_action');
  assert.equal((await by('police').send('round:raiseHand')).error!.code, 'illegal_action'); // too early
  assert.equal((await chor.send('chat:send', { text: 'hello' })).error!.code, 'chat_closed');

  assert.ok((await by('officer').send('round:raiseHand', { order: 'chor' })).ok);
  assert.ok((await by('police').send('round:raiseHand')).ok);
  await Promise.all(clients.map((c) => c.until(() => c.state.round.phase === 'discussion', 'discussion')));
  for (const c of clients) {
    assert.deepEqual(c.state.round.verified, {
      [by('officer').playerId]: 'officer',
      [by('police').playerId]: 'police',
    });
  }

  assert.ok((await chor.send('chat:send', { text: "I'm the Police!" })).ok);
  await Promise.all(clients.map((c) => c.until(() => c.chat.some((m) => m.text === "I'm the Police!"), 'chat sync')));
  const msg = clients[0].chat.find((m) => m.text === "I'm the Police!");
  assert.equal(msg.kind, 'chat'); // never styled as an official announcement
  assert.equal(msg.playerId, chor.playerId);
  assert.ok(!(chor.playerId in clients[0].state.round.verified));
  // Police may not investigate while the discussion timer is running.
  assert.equal((await by('police').send('investigation:submit', { targetId: chor.playerId })).error!.code, 'illegal_action');
});

test('a client cannot act as someone else or change roles/scores via payload tricks', async () => {
  const { by } = await started();
  const res = await by('chor').send('round:raiseHand', { playerId: by('officer').playerId });
  assert.equal(res.error!.code, 'bad_payload');
  const res2 = await by('chor').send('chat:send', { text: 'x', playerId: by('police').playerId, kind: 'system' });
  assert.equal(res2.error!.code, 'bad_payload');
});

test('reconnecting with the token restores the same role and does not reroll', async () => {
  const { clients, roomCode, by } = await started();
  const police = by('police');
  const { token, playerId } = police;
  police.sock.disconnect();
  await clients[0].until(() => clients[0].state.paused === true, 'pause');
  const fresh = new Client();
  const res = await fresh.send('room:join', { code: roomCode, token });
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.reconnected, true);
  assert.equal(res.playerId, playerId);
  await fresh.until(() => fresh.priv?.role, 'private role after reconnect');
  assert.equal(fresh.priv.role, 'police');
  await clients[0].until(() => clients[0].state.paused === false, 'resume');
  assert.equal(clients[0].state.players.length, 4);
  // Someone new cannot join a running match.
  const late = new Client();
  assert.equal((await late.send('room:join', { code: roomCode, name: 'Late' })).error!.code, 'already_started');
});

test('a second tab with the same token takes over; the old tab is told', async () => {
  const { roomCode, by } = await started();
  const o = by('officer');
  let replaced = false;
  o.sock.on('session:replaced', () => (replaced = true));
  const tab2 = new Client();
  assert.ok((await tab2.send('room:join', { code: roomCode, token: o.token })).ok);
  await o.until(() => replaced, 'session:replaced');
  await tab2.until(() => tab2.priv?.role === 'officer', 'tab2 gets the same role');
});

test('host can remove a player in the lobby; non-host cannot', async () => {
  const { clients } = await lobby();
  assert.equal((await clients[1].send('lobby:kick', { playerId: clients[2].playerId })).error!.code, 'not_host');
  let kicked = false;
  clients[3].sock.on('room:kicked', () => (kicked = true));
  assert.ok((await clients[0].send('lobby:kick', { playerId: clients[3].playerId })).ok);
  await clients[3].until(() => kicked, 'kicked');
  await clients[0].until(() => clients[0].state.players.length === 3, 'player removed');
});

test('stale deadline: server clock, not the client, decides phase changes', async () => {
  // Uses the manager directly on the live server to move time forward without waiting 60 seconds.
  const { clients, roomCode, by } = await started();
  await by('officer').send('round:raiseHand', { order: 'chor' });
  await by('police').send('round:raiseHand');
  await clients[0].until(() => clients[0].state.round.phase === 'discussion', 'discussion');
  const room = server.manager.get(roomCode);
  room.round!.deadline = Date.now() - 1; // pretend the 60s elapsed
  await Promise.all(clients.map((c) => c.until(() => c.state.round.phase === 'investigation', 'investigation phase')));
  const chor = by('chor');
  assert.ok((await by('police').send('investigation:submit', { targetId: chor.playerId })).ok);
  await Promise.all(clients.map((c) => c.until(() => c.state.round.phase === 'result', 'result')));
  const scores = Object.fromEntries(clients[0].state.players.map((p: any) => [p.id, p.score]));
  assert.equal(scores[by('officer').playerId], 50);
  assert.equal(scores[by('police').playerId], 30);
  assert.equal(scores[by('daket').playerId], -15); // Police found the Chor: Daket and Chor lose
  assert.equal(scores[chor.playerId], -10);
  // All roles are revealed only now.
  assert.equal(Object.keys(clients[0].state.round.result.roles).length, 4);
  // Replay is rejected and does not score twice.
  assert.equal((await by('police').send('investigation:submit', { targetId: by('daket').playerId })).ok, false);
  assert.equal(clients[0].state.players.find((p: any) => p.id === by('police').playerId).score, 30);
});

test('officer must send a valid order; it becomes public', async () => {
  const { clients, by } = await started();
  assert.equal((await by('officer').send('round:raiseHand')).error!.code, 'illegal_action'); // no order
  assert.equal((await by('officer').send('round:raiseHand', { order: 'police' })).error!.code, 'bad_payload');
  assert.ok((await by('officer').send('round:raiseHand', { order: 'daket' })).ok);
  await Promise.all(clients.map((c) => c.until(() => c.state.round.order === 'daket', 'public order')));
});

test('skip vote: three votes end the discussion for everyone', async () => {
  const { clients, by } = await started();
  await by('officer').send('round:raiseHand', { order: 'chor' });
  await by('police').send('round:raiseHand');
  await clients[0].until(() => clients[0].state.round.phase === 'discussion', 'discussion');
  assert.equal((await clients[0].send('round:skipVote', { vote: 'yes' })).error!.code, 'bad_payload');
  assert.ok((await clients[0].send('round:skipVote', { vote: true })).ok);
  assert.ok((await clients[1].send('round:skipVote', { vote: true })).ok);
  await clients[3].until(() => clients[3].state.round.skipVotes.length === 2, 'two public votes');
  assert.equal(clients[3].state.round.phase, 'discussion');
  assert.ok((await clients[2].send('round:skipVote', { vote: true })).ok);
  await Promise.all(clients.map((c) => c.until(() => c.state.round.phase === 'investigation', 'skipped to investigation')));
  assert.equal((await clients[3].send('round:skipVote', { vote: true })).error!.code, 'illegal_action'); // too late
});

test('characters: peek shows what is taken, duplicate name or character is refused, pick is public', async () => {
  const host = new Client();
  const created = await host.send('room:create', { name: 'Ann', character: 5 });
  assert.ok(created.ok, JSON.stringify(created));
  const guest = new Client();
  const peek = await guest.send('room:peek', { code: created.code });
  assert.ok(peek.ok);
  assert.deepEqual(peek.takenCharacters, [5]);
  assert.deepEqual(peek.takenNames, ['Ann']);
  assert.equal((await guest.send('room:peek', { code: 'ZZZZZ' })).error!.code, 'room_not_found');
  assert.equal((await guest.send('room:join', { code: created.code, name: 'ann', character: 2 })).error!.code, 'name_taken');
  assert.equal((await guest.send('room:join', { code: created.code, name: 'Bob', character: 5 })).error!.code, 'character_taken');
  assert.equal((await guest.send('room:join', { code: created.code, name: 'Bob', character: 12 })).error!.code, 'bad_payload');
  const ok = await guest.send('room:join', { code: created.code, name: 'Bob', character: 2 });
  assert.ok(ok.ok, JSON.stringify(ok));
  await host.until(() => host.state?.players.length === 2, 'two players');
  assert.deepEqual(host.state.players.map((p: any) => p.character), [5, 2]);
});
