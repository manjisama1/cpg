import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { RoomManager, GameError, CHARACTER_COUNT, type Room } from './rooms.ts';

export interface AppOptions {
  corsOrigin?: string[];
  tickMs?: number;
  clock?: () => number;
  clientDist?: string;
  joinLimitPerMinute?: number; // per IP; default 20
}

const name = z.string().min(1).max(40);
const code = z.string().min(3).max(12);
const token = z.string().min(10).max(100);
const id = z.string().min(1).max(64);
const character = z.number().int().min(0).max(CHARACTER_COUNT - 1);
const empty = z.object({}).strict();

const schemas = {
  create: z.object({ name, character: character.optional() }).strict(),
  join: z.object({ code, name: name.optional(), character: character.optional(), token: token.optional() }).strict(),
  peek: z.object({ code }).strict(),
  ready: z.object({ ready: z.boolean() }).strict(),
  raise: z.object({ order: z.enum(['chor', 'daket']).optional() }).strict(),
  skip: z.object({ vote: z.boolean() }).strict(),
  settings: z.object({
    rounds: z.number().int().optional(),
    discussionMs: z.number().int().optional(),
    investigationMs: z.number().int().optional(),
    fallbackMs: z.number().int().optional(),
    graceMs: z.number().int().optional(),
  }).strict(),
  kick: z.object({ playerId: id }).strict(),
  chat: z.object({ text: z.string().min(1).max(2000) }).strict(),
  target: z.object({ targetId: id }).strict(),
};

/** Sliding-window limiter keyed by string. */
function makeLimiter(max: number, windowMs: number, clock: () => number) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const t = clock();
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] >= windowMs) hits.delete(k);
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    return true;
  };
}

export function createGameServer(opts: AppOptions = {}) {
  const now = opts.clock ?? Date.now;
  const manager = new RoomManager();

  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size }));
  const dist = opts.clientDist ?? process.env.CLIENT_DIST;
  if (dist && existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile('index.html', { root: dist }));
  }

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 10_000, // our payloads are tiny; refuse anything big
    cors: opts.corsOrigin?.length ? { origin: opts.corsOrigin } : undefined,
  });

  const eventLimit = makeLimiter(40, 5000, now); // per socket
  const peekLimit = makeLimiter(60, 60_000, now); // per IP: peeking is cheap but still guessable
  const joinLimit = makeLimiter(opts.joinLimitPerMinute ?? 20, 60_000, now); // per IP: slows room-code guessing

  // ---- broadcasting ----
  function sendPrivate(room: Room, playerId: string) {
    const p = room.players.find((q) => q.id === playerId);
    if (p?.socketId) io.to(p.socketId).emit('player:private', manager.privateView(room, playerId));
  }
  /** Push everything clients haven't seen yet. Safe to call as often as you like. */
  function flush(room: Room) {
    for (const m of manager.takeNewChat(room)) io.to(room.code).emit('chat:message', m);
    io.to(room.code).emit('room:state', manager.publicView(room, now()));
    const key = `${room.state}:${room.roundNo}`;
    if (key !== room.sentRoundKey) {
      room.sentRoundKey = key;
      for (const p of room.players) sendPrivate(room, p.id); // each player gets only their own role
    }
    manager.markSent(room);
  }
  function dropSocket(socketId: string, event: string) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) return;
    s.emit(event);
    if (s.data.code) s.leave(s.data.code);
    s.data = {};
  }
  function enter(socket: Socket, room: Room, playerId: string) {
    socket.data = { code: room.code, playerId };
    socket.join(room.code);
    socket.emit('chat:history', room.chat);
    socket.emit('player:private', manager.privateView(room, playerId));
  }
  const session = (socket: Socket) => {
    const { code: c, playerId } = socket.data as { code?: string; playerId?: string };
    if (!c || !playerId) throw new GameError('no_session', 'Join a room first');
    return { code: c, playerId };
  };

  // ---- event binding ----
  io.on('connection', (socket) => {
    socket.data = {};

    const bind = <S extends z.ZodType>(event: string, schema: S, fn: (d: z.infer<S>) => Record<string, unknown> | void) => {
      socket.on(event, (raw: unknown, ack?: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
        try {
          if (!eventLimit(socket.id)) throw new GameError('rate_limited', 'Slow down');
          const parsed = schema.safeParse(raw ?? {});
          if (!parsed.success) throw new GameError('bad_payload', 'Invalid request');
          const out = fn(parsed.data) ?? {};
          reply({ ok: true, ...out });
        } catch (e) {
          const err = e instanceof GameError ? e : (console.error(e), new GameError('internal', 'Something went wrong'));
          reply({ ok: false, error: { code: err.code, message: err.message } });
        }
        // Even a rejected action may have moved the server clock forward, so always sync.
        const c = (socket.data as { code?: string }).code;
        const room = c ? manager.rooms.get(c) : undefined;
        if (room) flush(room);
      });
    };

    const ipOk = () => {
      if (!joinLimit(socket.handshake.address)) throw new GameError('rate_limited', 'Too many attempts, wait a minute');
    };
    const notInRoom = () => {
      if (socket.data.code) throw new GameError('already_in_room', 'Leave your current room first');
    };

    bind('room:create', schemas.create, (d) => {
      ipOk();
      notInRoom();
      const { room, player } = manager.createRoom(d.name, socket.id, now(), d.character);
      enter(socket, room, player.id);
      return { code: room.code, playerId: player.id, token: player.token };
    });

    bind('room:join', schemas.join, (d) => {
      ipOk();
      notInRoom();
      const r = manager.join(d.code, { name: d.name, token: d.token, character: d.character }, socket.id, now());
      if (r.replacedSocketId) dropSocket(r.replacedSocketId, 'session:replaced');
      enter(socket, r.room, r.player.id);
      return { code: r.room.code, playerId: r.player.id, token: r.player.token, reconnected: r.reconnected };
    });

    // Lets the join screen grey out characters and names that are already used in that room.
    bind('room:peek', schemas.peek, (d) => {
      if (!peekLimit(socket.handshake.address)) throw new GameError('rate_limited', 'Too many attempts, wait a minute');
      return manager.peek(d.code);
    });

    bind('room:leave', empty, () => {
      const { code: c, playerId } = session(socket);
      const room = manager.leave(c, playerId, now());
      socket.leave(c);
      socket.data = {};
      if (room) flush(room);
    });

    bind('lobby:ready', schemas.ready, (d) => {
      const s = session(socket);
      manager.setReady(s.code, s.playerId, d.ready, now());
    });
    bind('lobby:updateSettings', schemas.settings, (d) => {
      const s = session(socket);
      manager.updateSettings(s.code, s.playerId, d, now());
    });
    bind('lobby:kick', schemas.kick, (d) => {
      const s = session(socket);
      const removed = manager.kick(s.code, s.playerId, d.playerId, now());
      if (removed.socketId) dropSocket(removed.socketId, 'room:kicked');
    });
    bind('match:start', empty, () => {
      const s = session(socket);
      manager.startMatch(s.code, s.playerId, now());
    });
    bind('match:advance', empty, () => {
      const s = session(socket);
      manager.advance(s.code, s.playerId, now());
    });
    bind('match:restart', empty, () => {
      const s = session(socket);
      manager.restart(s.code, s.playerId, now());
    });
    bind('round:raiseHand', schemas.raise, (d) => {
      const s = session(socket);
      manager.raiseHand(s.code, s.playerId, now(), d.order);
    });
    bind('round:skipVote', schemas.skip, (d) => {
      const s = session(socket);
      manager.voteSkip(s.code, s.playerId, d.vote, now());
    });
    bind('chat:send', schemas.chat, (d) => {
      const s = session(socket);
      manager.addChat(s.code, s.playerId, d.text, now());
    });
    bind('investigation:submit', schemas.target, (d) => {
      const s = session(socket);
      manager.submitInvestigation(s.code, s.playerId, d.targetId, now());
    });
    bind('officer:fallbackSubmit', schemas.target, (d) => {
      const s = session(socket);
      manager.submitFallback(s.code, s.playerId, d.targetId, now());
    });

    socket.on('disconnect', () => {
      const { code: c } = socket.data as { code?: string };
      if (!c) return;
      const room = manager.detach(c, socket.id, now());
      if (room) flush(room);
    });
  });

  // ---- server clock ----
  const timer = setInterval(() => {
    const { changed } = manager.tick(now());
    changed.forEach(flush);
  }, opts.tickMs ?? 250);

  return {
    app, httpServer, io, manager,
    listen(port: number): Promise<number> {
      return new Promise((resolve) =>
        httpServer.listen(port, () => resolve((httpServer.address() as { port: number }).port)));
    },
    close(): Promise<void> {
      clearInterval(timer);
      return new Promise((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}
