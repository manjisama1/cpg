import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  Round, Scoreboard, DEFAULT_SETTINGS, validateSettings,
  type Order, type Role, type RoundResult, type Settings,
} from './engine.ts';

// ---------- errors ----------
export class GameError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}
function fail(code: string, message: string): never {
  throw new GameError(code, message);
}
/** Convert engine errors (plain Error) into GameErrors. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GameError) throw e;
    return fail('illegal_action', e instanceof Error ? e.message : 'Illegal action');
  }
}

// ---------- constants & types ----------
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1
export const CODE_LENGTH = 5;
export const PLAYERS_PER_ROOM = 4;
export const CHARACTER_COUNT = 10; // selectable looks; the client draws them, the server only tracks the number
const ROOM_TTL_MS = 10 * 60_000;
const CHAT_CAP = 200;

export interface MatchSettings extends Settings {
  rounds: number;
  graceMs: number; // reconnection grace period
}
export const DEFAULT_MATCH_SETTINGS: MatchSettings = { ...DEFAULT_SETTINGS, rounds: 5, graceMs: 60_000 };
const SETTING_KEYS = ['rounds', 'discussionMs', 'investigationMs', 'fallbackMs', 'graceMs'] as const;
export type SettingsPatch = Partial<Pick<MatchSettings, (typeof SETTING_KEYS)[number]>>;

export function validateMatchSettings(s: MatchSettings): MatchSettings {
  try {
    validateSettings(s);
  } catch (e) {
    fail('bad_settings', (e as Error).message);
  }
  if (!Number.isInteger(s.rounds) || s.rounds < 1 || s.rounds > 10) fail('bad_settings', 'Rounds must be 1 to 10');
  if (!Number.isInteger(s.graceMs) || s.graceMs < 10_000 || s.graceMs > 300_000)
    fail('bad_settings', 'Reconnect grace must be 10 to 300 seconds');
  return { ...s };
}

export interface Player {
  id: string;
  name: string;
  character: number; // index into the client's character list, unique inside a room
  token: string; // secret session credential; never put in a broadcast
  ready: boolean;
  connected: boolean;
  socketId: string | null;
  disconnectedAt: number | null;
}
export interface ChatMessage {
  id: number;
  kind: 'chat' | 'system'; // only the server creates 'system' messages
  playerId: string | null;
  name: string;
  text: string;
  ts: number;
}
export type MatchState = 'lobby' | 'playing' | 'complete' | 'aborted';

export interface Room {
  code: string;
  isPublic: boolean;
  hostId: string;
  players: Player[];
  settings: MatchSettings;
  state: MatchState;
  roundNo: number;
  round: Round | null;
  scoreboard: Scoreboard;
  rounds: { round: number; result: RoundResult }[];
  chat: ChatMessage[];
  chatSeq: number;
  pausedAt: number | null;
  createdAt: number;
  lastActive: number;
  rate: Map<string, number[]>;
  reactionAt: Map<string, number>;
  // broadcast bookkeeping
  dirty: boolean;
  sentPhase: string | null;
  sentState: MatchState | null;
  sentPaused: boolean;
  sentChatId: number;
  sentRoundKey: string;
}

// ---------- sanitizers ----------
const INVISIBLE = '\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069';
const NAME_STRIP = new RegExp(`[\\u0000-\\u001f\\u007f${INVISIBLE}<>]`, 'g');
const CHAT_STRIP = new RegExp(`[\\u0000-\\u0009\\u000b-\\u001f\\u007f${INVISIBLE}]`, 'g');

export function sanitizeName(raw: string): string {
  const s = raw.replace(NAME_STRIP, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!s) fail('bad_name', 'Enter a display name');
  return s;
}
export function sanitizeChat(raw: string): string {
  const s = raw.replace(CHAT_STRIP, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 300);
  if (!s) fail('bad_message', 'Message is empty');
  return s;
}

const makeCode = () => {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
};
const tokenEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const newPlayer = (name: string, character: number): Player => ({
  id: randomBytes(6).toString('hex'),
  name,
  character,
  token: randomBytes(24).toString('base64url'),
  ready: false,
  connected: false,
  socketId: null,
  disconnectedAt: null,
});

function validateCharacter(c: unknown): number {
  if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= CHARACTER_COUNT)
    fail('bad_character', 'Pick one of the characters');
  return c;
}

// ---------- manager ----------
export class RoomManager {
  rooms = new Map<string, Room>();
  maxRooms: number;

  constructor(opts: { maxRooms?: number } = {}) {
    this.maxRooms = opts.maxRooms ?? 2000;
  }

  // ----- lookup -----
  get(code: string): Room {
    const room = this.rooms.get(String(code).trim().toUpperCase());
    return room ?? fail('room_not_found', 'No room with that code (it may have expired)');
  }
  private ctx(code: string, playerId: string, now: number) {
    const room = this.get(code);
    const player = room.players.find((p) => p.id === playerId) ?? fail('not_in_room', 'You are not in this room');
    room.lastActive = now;
    return { room, player };
  }
  private requireHost(room: Room, playerId: string) {
    if (room.hostId !== playerId) fail('not_host', 'Only the host can do that');
  }
  private requirePlaying(room: Room) {
    if (room.state !== 'playing' || !room.round) fail('wrong_state', 'No round in progress');
    if (room.pausedAt !== null) fail('paused', 'Paused until everyone reconnects');
  }

  // ----- chat -----
  private pushChat(room: Room, kind: 'chat' | 'system', player: Player | null, text: string, now: number) {
    const m: ChatMessage = {
      id: ++room.chatSeq, kind, playerId: player?.id ?? null,
      name: player?.name ?? 'Game', text, ts: now,
    };
    room.chat.push(m);
    if (room.chat.length > CHAT_CAP) room.chat.shift();
    room.dirty = true;
    return m;
  }
  addChat(code: string, playerId: string, text: string, now: number): ChatMessage {
    const { room, player } = this.ctx(code, playerId, now);
    this.sync(room, now);
    const phase = room.round?.phase;
    const open = room.state !== 'playing' || phase === 'discussion' || phase === 'result';
    if (!open) fail('chat_closed', 'Chat is closed during this phase');
    const clean = sanitizeChat(text);
    const hits = (room.rate.get(playerId) ?? []).filter((t) => now - t < 5000);
    if (hits.length >= 5 || (hits.length && now - hits[hits.length - 1] < 500)) {
      room.rate.set(playerId, hits);
      fail('rate_limited', 'You are sending messages too fast');
    }
    hits.push(now);
    room.rate.set(playerId, hits);
    return this.pushChat(room, 'chat', player, clean, now);
  }

  addReaction(code: string, playerId: string, now: number) {
    const { room, player } = this.ctx(code, playerId, now);
    if (room.state !== 'playing') fail('wrong_state', 'Reactions are available during a match');
    const last = room.reactionAt.get(playerId);
    if (last !== undefined && now - last < 900) fail('rate_limited', 'Wait a moment before reacting again');
    room.reactionAt.set(playerId, now);
    return { id: randomBytes(6).toString('hex'), playerId, name: player.name, character: player.character, ts: now };
  }

  // ----- room lifecycle -----
  createRoom(name: string, socketId: string, now: number, character = 0, isPublic = true) {
    if (this.rooms.size >= this.maxRooms) fail('server_busy', 'Server is full, try again later');
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const player = newPlayer(sanitizeName(name), validateCharacter(character));
    const room: Room = {
      code, hostId: player.id, players: [player], isPublic,
      settings: { ...DEFAULT_MATCH_SETTINGS }, state: 'lobby', roundNo: 0, round: null,
      scoreboard: new Scoreboard([]), rounds: [], chat: [], chatSeq: 0, pausedAt: null,
      createdAt: now, lastActive: now, rate: new Map(), reactionAt: new Map(),
      dirty: true, sentPhase: null, sentState: null, sentPaused: false, sentChatId: 0, sentRoundKey: '',
    };
    this.rooms.set(code, room);
    this.attach(room, player, socketId, now);
    return { room, player };
  }

  /** Public lobby directory. Only rooms accepting new players are discoverable. */
  publicRooms() {
    return [...this.rooms.values()]
      .filter((room) => room.isPublic && room.state === 'lobby' && room.players.length < PLAYERS_PER_ROOM)
      .map((room) => ({
        code: room.code,
        isPublic: room.isPublic,
        hostName: room.players.find((p) => p.id === room.hostId)?.name ?? 'Host',
        players: room.players.length,
        capacity: PLAYERS_PER_ROOM,
        createdAt: room.createdAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** What a would-be joiner may know before joining: which looks and names are already taken. */
  peek(code: string) {
    const room = this.get(code);
    return {
      code: room.code,
      open: room.state === 'lobby' && room.players.length < PLAYERS_PER_ROOM,
      takenCharacters: room.players.map((p) => p.character),
      takenNames: room.players.map((p) => p.name),
    };
  }

  join(code: string, opts: { name?: string; token?: string; character?: number }, socketId: string, now: number) {
    const room = this.get(code);
    if (opts.token) {
      const existing = room.players.find((p) => tokenEq(p.token, opts.token!));
      if (existing) {
        const replacedSocketId = this.attach(room, existing, socketId, now);
        this.pushChat(room, 'system', null, `${existing.name} reconnected`, now);
        return { room, player: existing, reconnected: true, replacedSocketId };
      }
    }
    if (room.state !== 'lobby') fail('already_started', 'That match has already started');
    if (room.players.length >= PLAYERS_PER_ROOM) fail('room_full', 'That room is full');
    const name = sanitizeName(opts.name ?? '');
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      fail('name_taken', 'Someone in this room already has that name. Pick another name.');
    const used = new Set(room.players.map((p) => p.character));
    let character: number;
    if (opts.character === undefined) {
      // No pick sent (older client): hand out the first free look.
      character = Array.from({ length: CHARACTER_COUNT }, (_, i) => i).find((i) => !used.has(i))!;
    } else {
      character = validateCharacter(opts.character);
      if (used.has(character)) fail('character_taken', 'Someone in this room already picked that character. Pick another one.');
    }
    const player = newPlayer(name, character);
    room.players.push(player);
    this.attach(room, player, socketId, now);
    this.pushChat(room, 'system', null, `${player.name} joined`, now);
    return { room, player, reconnected: false, replacedSocketId: null as string | null };
  }

  /** Bind a socket to a player. Returns a previous socket id if one was displaced. */
  private attach(room: Room, p: Player, socketId: string, now: number): string | null {
    const replaced = p.socketId && p.socketId !== socketId ? p.socketId : null;
    p.socketId = socketId;
    p.connected = true;
    p.disconnectedAt = null;
    room.lastActive = now;
    room.dirty = true;
    if (room.pausedAt !== null && room.players.every((q) => q.connected)) {
      // Resume without handing out free time: push the deadline by the paused duration.
      if (room.round?.deadline != null) room.round.deadline += now - room.pausedAt;
      room.pausedAt = null;
      this.pushChat(room, 'system', null, 'Everyone is back. Game resumes.', now);
    }
    return replaced;
  }

  /** A socket dropped. Returns the room if it belonged to a player. */
  detach(code: string, socketId: string, now: number): Room | null {
    const room = this.rooms.get(code);
    const p = room?.players.find((q) => q.socketId === socketId);
    if (!room || !p) return null;
    p.connected = false;
    p.socketId = null;
    p.disconnectedAt = now;
    room.lastActive = now;
    room.dirty = true;
    if (room.state === 'playing' && room.pausedAt === null) {
      this.sync(room, now); // settle anything already due before pausing
      if (room.state === 'playing' && room.round?.phase !== 'result') room.pausedAt = now;
      this.pushChat(room, 'system', null, `${p.name} disconnected. Waiting up to ${Math.round(room.settings.graceMs / 1000)}s.`, now);
    }
    return room;
  }

  private removePlayer(room: Room, playerId: string) {
    room.players = room.players.filter((p) => p.id !== playerId);
    room.dirty = true;
    if (room.hostId === playerId && room.players.length) {
      const next = room.players.find((p) => p.connected) ?? room.players[0];
      room.hostId = next.id;
      this.pushChat(room, 'system', null, `${next.name} is now the host`, Date.now());
    }
    if (!room.players.length) this.rooms.delete(room.code);
  }

  leave(code: string, playerId: string, now: number): Room | null {
    const { room, player } = this.ctx(code, playerId, now);
    if (room.state === 'playing') {
      this.abort(room, `${player.name} left. Match ended.`);
      player.connected = false;
      player.socketId = null;
      return room;
    }
    this.pushChat(room, 'system', null, `${player.name} left`, now);
    this.removePlayer(room, playerId);
    return this.rooms.get(code) ?? null;
  }

  kick(code: string, hostId: string, targetId: string, now: number): Player {
    const { room } = this.ctx(code, hostId, now);
    this.requireHost(room, hostId);
    if (room.state !== 'lobby') fail('wrong_state', 'Can only remove players before the match starts');
    if (targetId === hostId) fail('bad_target', 'You cannot remove yourself');
    const target = room.players.find((p) => p.id === targetId) ?? fail('bad_target', 'No such player');
    this.pushChat(room, 'system', null, `${target.name} was removed by the host`, now);
    this.removePlayer(room, targetId);
    return target;
  }

  // ----- lobby -----
  setReady(code: string, playerId: string, ready: boolean, now: number) {
    const { room, player } = this.ctx(code, playerId, now);
    if (room.state !== 'lobby') fail('wrong_state', 'Ready only applies in the lobby');
    if (player.ready !== ready) {
      player.ready = ready;
      room.dirty = true;
    }
    return room;
  }

  updateSettings(code: string, playerId: string, patch: SettingsPatch, now: number) {
    const { room } = this.ctx(code, playerId, now);
    this.requireHost(room, playerId);
    if (room.state !== 'lobby') fail('wrong_state', 'Settings are locked once the match starts');
    const next = { ...room.settings };
    for (const k of SETTING_KEYS) if (patch[k] !== undefined) next[k] = patch[k] as number;
    room.settings = validateMatchSettings(next);
    room.dirty = true;
    return room;
  }

  startMatch(code: string, playerId: string, now: number) {
    const { room } = this.ctx(code, playerId, now);
    this.requireHost(room, playerId);
    if (room.state !== 'lobby') fail('wrong_state', 'Match already started');
    if (room.players.length !== PLAYERS_PER_ROOM) fail('need_four', 'Exactly four players are needed');
    if (!room.players.every((p) => p.connected)) fail('not_connected', 'Everyone must be connected');
    if (!room.players.every((p) => p.ready)) fail('not_ready', 'Everyone must be ready');
    room.scoreboard = new Scoreboard(room.players.map((p) => p.id));
    room.rounds = [];
    room.roundNo = 0;
    room.pausedAt = null;
    room.state = 'playing';
    this.pushChat(room, 'system', null, 'Match started!', now);
    this.startRound(room, now);
    return room;
  }

  private startRound(room: Room, now: number) {
    room.roundNo++;
    room.round = new Round(room.players.map((p) => p.id), room.settings);
    this.pushChat(room, 'system', null, `Round ${room.roundNo} of ${room.settings.rounds}. Officer, raise your hand!`, now);
  }

  // ----- gameplay -----
  /** Apply any server-clock transitions that are due. */
  private sync(room: Room, now: number) {
    if (room.state !== 'playing' || room.pausedAt !== null || !room.round) return;
    room.round.tick(now);
    this.settle(room, now);
  }

  /** Scores are applied exactly once per round (Scoreboard is keyed by round number). */
  private settle(room: Room, now: number) {
    const result = room.round?.result;
    if (!result) return;
    if (room.scoreboard.apply(room.roundNo, result.deltas)) {
      room.rounds.push({ round: room.roundNo, result });
      const target = result.order === 'chor' ? 'Chor' : 'Daket';
      const text = {
        police_correct: `The Police found the ${target}! Officer and Police win the round.`,
        police_wrong: `The Police picked the wrong player. Daket and Chor win the round.`,
        police_timeout: 'The Police ran out of time.',
      }[result.outcome];
      this.pushChat(room, 'system', null, `Round ${room.roundNo} over. ${text}`, now);
    }
  }

  raiseHand(code: string, playerId: string, now: number, order?: Order) {
    const { room, player } = this.ctx(code, playerId, now);
    this.sync(room, now);
    this.requirePlaying(room);
    const round = room.round!;
    const before = round.phase;
    guard(() => round.raiseHand(playerId, now, order));
    this.pushChat(room, 'system', null,
      before === 'officer_call'
        ? `${player.name} is the Officer! Order: find the ${round.order === 'daket' ? 'Daket' : 'Chor'}. Police, raise your hand.`
        : `${player.name} is the Police! Discussion starts now.`, now);
    return room;
  }

  voteSkip(code: string, playerId: string, vote: boolean, now: number) {
    const { room, player } = this.ctx(code, playerId, now);
    this.sync(room, now);
    this.requirePlaying(room);
    const ended = guard(() => room.round!.voteSkip(playerId, vote, now));
    room.dirty = true; // vote counts are public, so push them out
    if (ended) this.pushChat(room, 'system', null, 'Skip vote passed. Discussion is over. Police, make your choice!', now);
    else if (vote) this.pushChat(room, 'system', null, `${player.name} voted to skip the discussion (${room.round!.skipVotes.size}/${room.round!.publicView().skipNeeded})`, now);
    return room;
  }

  submitInvestigation(code: string, playerId: string, targetId: string, now: number) {
    const { room } = this.ctx(code, playerId, now);
    this.sync(room, now);
    this.requirePlaying(room);
    guard(() => room.round!.submitInvestigation(playerId, targetId, now));
    this.settle(room, now);
    return room;
  }

  submitFallback(code: string, playerId: string, targetId: string, now: number) {
    const { room } = this.ctx(code, playerId, now);
    this.sync(room, now);
    this.requirePlaying(room);
    guard(() => room.round!.submitFallback(playerId, targetId, now));
    this.settle(room, now);
    return room;
  }

  /** Host moves from the result screen to the next round (or to the final screen). */
  advance(code: string, playerId: string, now: number) {
    const { room } = this.ctx(code, playerId, now);
    this.requireHost(room, playerId);
    this.sync(room, now);
    this.requirePlaying(room);
    if (room.round!.phase !== 'result') fail('wrong_state', 'The round is not over yet');
    if (room.roundNo < room.settings.rounds) this.startRound(room, now);
    else {
      room.state = 'complete';
      room.dirty = true;
    }
    return room;
  }

  restart(code: string, playerId: string, now: number) {
    const { room } = this.ctx(code, playerId, now);
    this.requireHost(room, playerId);
    if (room.state !== 'complete' && room.state !== 'aborted') fail('wrong_state', 'The match is not finished');
    room.state = 'lobby';
    room.round = null;
    room.roundNo = 0;
    room.rounds = [];
    room.pausedAt = null;
    room.scoreboard = new Scoreboard([]);
    room.players.forEach((p) => (p.ready = false));
    room.dirty = true;
    this.pushChat(room, 'system', null, 'Back in the lobby. Ready up for a rematch!', now);
    return room;
  }

  private abort(room: Room, text: string) {
    room.state = 'aborted';
    room.pausedAt = null;
    room.dirty = true;
    this.pushChat(room, 'system', null, text, Date.now());
  }

  // ----- clock -----
  /** Run periodically. Returns rooms whose public state changed and codes that were deleted. */
  tick(now: number) {
    const changed: Room[] = [];
    const deleted: string[] = [];
    for (const room of [...this.rooms.values()]) {
      if (room.state === 'playing') {
        if (room.pausedAt !== null) {
          if (now - room.pausedAt >= room.settings.graceMs)
            this.abort(room, 'A player did not come back in time. Match ended.');
        } else this.sync(room, now);
      } else if (room.state === 'lobby') {
        for (const p of room.players.filter((q) => !q.connected && q.disconnectedAt !== null && now - q.disconnectedAt >= room.settings.graceMs)) {
          this.pushChat(room, 'system', null, `${p.name} was removed (disconnected)`, now);
          this.removePlayer(room, p.id);
        }
      }
      if (!this.rooms.has(room.code) || room.players.length === 0 ||
          (room.players.every((p) => !p.connected) && now - room.lastActive > ROOM_TTL_MS)) {
        this.rooms.delete(room.code);
        deleted.push(room.code);
        continue;
      }
      if (this.needsFlush(room)) changed.push(room);
    }
    return { changed, deleted };
  }

  // ----- broadcast bookkeeping -----
  needsFlush(room: Room) {
    return room.dirty || (room.round?.phase ?? null) !== room.sentPhase ||
      room.state !== room.sentState || (room.pausedAt !== null) !== room.sentPaused;
  }
  takeNewChat(room: Room): ChatMessage[] {
    const fresh = room.chat.filter((m) => m.id > room.sentChatId);
    room.sentChatId = room.chatSeq;
    return fresh;
  }
  markSent(room: Room) {
    room.dirty = false;
    room.sentPhase = room.round?.phase ?? null;
    room.sentState = room.state;
    room.sentPaused = room.pausedAt !== null;
  }

  // ----- views -----
  /** Safe to broadcast to everyone in the room. Contains no tokens and no unrevealed roles. */
  publicView(room: Room, now: number) {
    return {
      code: room.code,
      isPublic: room.isPublic,
      state: room.state,
      hostId: room.hostId,
      settings: room.settings,
      roundNo: room.roundNo,
      serverTime: now,
      paused: room.pausedAt !== null,
      pauseEndsAt: room.pausedAt !== null ? room.pausedAt + room.settings.graceMs : null,
      players: room.players.map((p) => ({
        id: p.id, name: p.name, character: p.character, ready: p.ready, connected: p.connected,
        isHost: p.id === room.hostId, score: room.scoreboard.totals[p.id] ?? 0,
      })),
      round: room.round ? room.round.publicView() : null,
      history: room.rounds.map((r) => ({ round: r.round, ...r.result })),
      final: room.state === 'complete' ? this.finalResults(room) : null,
    };
  }

  /** Only ever send this to the player's own socket. */
  privateView(room: Room, playerId: string) {
    const role: Role | undefined = room.state === 'playing' ? room.round?.roleOf(playerId) : undefined;
    return { playerId, role: role ?? null, roundNo: room.roundNo };
  }

  finalResults(room: Room) {
    const rows = room.players.map((p) => {
      const row = {
        playerId: p.id, name: p.name, total: room.scoreboard.totals[p.id] ?? 0,
        perRound: [] as number[], roles: [] as Role[], correct: 0, wrong: 0, timeouts: 0, rank: 0,
      };
      for (const { result } of room.rounds) {
        row.perRound.push(result.deltas[p.id]);
        row.roles.push(result.roles[p.id]);
        if (result.roles[p.id] === 'police') {
          if (result.outcome === 'police_correct') row.correct++;
          else if (result.outcome === 'police_wrong') row.wrong++;
          else row.timeouts++;
        }
      }
      return row;
    });
    rows.sort((a, b) => b.total - a.total);
    // Competition ranking: equal scores share a rank, no hidden tie-breaker.
    for (const r of rows) r.rank = 1 + rows.filter((o) => o.total > r.total).length;
    return rows;
  }
}
