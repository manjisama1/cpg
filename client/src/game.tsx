import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ChatMsg, CharacterReaction, PrivateInfo, PublicState } from './types';

export type Ack = { ok: boolean; error?: { code: string; message: string }; [k: string]: any };
export interface Notice { id: number; text: string; tone: 'error' | 'info' }
/** A themed in-game replacement for window.confirm. */
export interface AskOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'danger' | 'normal';
}
interface PendingAsk extends AskOptions { resolve: (yes: boolean) => void }

interface GameApi {
  connected: boolean;
  restoring: boolean;
  state: PublicState | null;
  priv: PrivateInfo | null;
  chat: ChatMsg[];
  reactions: CharacterReaction[];
  myId: string | null;
  notice: Notice | null;
  dismissNotice: () => void;
  notify: (text: string, tone?: 'error' | 'info') => void;
  /** Pass { silent: true } when the caller shows the error itself instead of a toast. */
  call: (event: string, payload?: object, opts?: { silent?: boolean }) => Promise<Ack>;
  createRoom: (name: string, character: number, isPublic?: boolean) => Promise<Ack>;
  joinRoom: (code: string, name: string, character: number) => Promise<Ack>;
  leaveRoom: () => Promise<void>;
  ask: (opts: AskOptions) => Promise<boolean>;
  pendingAsk: PendingAsk | null;
  answerAsk: (yes: boolean) => void;
}

// The session token lets a refreshed tab rejoin as the same player. sessionStorage is per-tab,
// and it never holds roles: those only ever arrive over the live socket.
const SESSION_KEY = 'cp.session';
interface Session { code: string; token: string; playerId: string }
const loadSession = (): Session | null => {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null;
  } catch { return null; }
};
const saveSession = (s: Session) => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* private mode */ } };
const clearSession = () => { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } };

const Ctx = createContext<GameApi | null>(null);
export const useGame = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGame must be used inside GameProvider');
  return v;
};

export function GameProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const sessionRef = useRef<Session | null>(loadSession());
  const noticeSeq = useRef(0);
  const [connected, setConnected] = useState(false);
  const [restoring, setRestoring] = useState(() => loadSession() !== null);
  const [state, setState] = useState<PublicState | null>(null);
  const [priv, setPriv] = useState<PrivateInfo | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [reactions, setReactions] = useState<CharacterReaction[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null);
  const askRef = useRef<PendingAsk | null>(null);

  const notify = useCallback((text: string, tone: 'error' | 'info' = 'info') => {
    setNotice({ id: ++noticeSeq.current, text, tone });
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const resetLocal = useCallback(() => {
    sessionRef.current = null;
    clearSession();
    setState(null);
    setPriv(null);
    setChat([]);
    setReactions([]);
  }, []);

  const call = useCallback(async (event: string, payload: object = {}, opts: { silent?: boolean } = {}): Promise<Ack> => {
    const socket = socketRef.current;
    if (!socket) return { ok: false, error: { code: 'network', message: 'Not connected' } };
    try {
      const res = (await socket.timeout(8000).emitWithAck(event, payload)) as Ack;
      if (!res.ok && res.error && !opts.silent) notify(res.error.message, 'error');
      return res;
    } catch {
      if (!opts.silent) notify('Connection problem. Please try again.', 'error');
      return { ok: false, error: { code: 'network', message: 'Connection problem. Please try again.' } };
    }
  }, [notify]);

  // Opens the in-game dialog and resolves with the player's answer. A second ask cancels the first.
  const ask = useCallback((opts: AskOptions) => new Promise<boolean>((resolve) => {
    askRef.current?.resolve(false);
    const p: PendingAsk = { ...opts, resolve };
    askRef.current = p;
    setPendingAsk(p);
  }), []);
  const answerAsk = useCallback((yes: boolean) => {
    const p = askRef.current;
    askRef.current = null;
    setPendingAsk(null);
    p?.resolve(yes);
  }, []);

  useEffect(() => {
    const socket = io(import.meta.env.VITE_SERVER_URL || undefined);
    socketRef.current = socket;
    const giveUp = window.setTimeout(() => setRestoring(false), 6000);

    // Runs on first connect and after every automatic reconnect: prove who we are with the token.
    const restore = async () => {
      const s = sessionRef.current;
      if (!s) { setRestoring(false); return; }
      try {
        const res = (await socket.timeout(8000).emitWithAck('room:join', { code: s.code, token: s.token })) as Ack;
        if (!res.ok) {
          const code = res.error?.code;
          if (code !== 'rate_limited' && code !== 'already_in_room') resetLocal();
        }
      } catch { /* next reconnect will retry */ }
      setRestoring(false);
    };

    socket.on('connect', () => { setConnected(true); void restore(); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('room:state', (s: PublicState) => setState(s));
    socket.on('player:private', (p: PrivateInfo) => setPriv(p));
    socket.on('chat:history', (h: ChatMsg[]) => setChat(h));
    socket.on('chat:message', (m: ChatMsg) =>
      setChat((c) => (c.some((x) => x.id === m.id) ? c : [...c, m].slice(-200))));
    socket.on('reaction:show', (r: CharacterReaction) => {
      setReactions((items) => [...items.filter((item) => item.id !== r.id), r].slice(-8));
      window.setTimeout(() => setReactions((items) => items.filter((item) => item.id !== r.id)), 2400);
    });
    socket.on('room:kicked', () => { resetLocal(); notify('The host removed you from the room.', 'error'); });
    socket.on('session:replaced', () => { resetLocal(); notify('This game was opened in another tab.', 'info'); });

    return () => {
      window.clearTimeout(giveUp);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [notify, resetLocal]);

  const enter = useCallback((res: Ack): Ack => {
    if (!res.ok) return res;
    const s = { code: res.code as string, token: res.token as string, playerId: res.playerId as string };
    sessionRef.current = s;
    saveSession(s);
    return res;
  }, []);

  // Errors here are shown inline on the home screen, so no toast.
  const createRoom = useCallback(
    async (name: string, character: number, isPublic = true) => enter(await call('room:create', { name, character, isPublic }, { silent: true })),
    [call, enter]);
  const joinRoom = useCallback(
    async (code: string, name: string, character: number) =>
      enter(await call('room:join', { code, name, character }, { silent: true })),
    [call, enter]);
  const leaveRoom = useCallback(async () => {
    await call('room:leave');
    resetLocal();
  }, [call, resetLocal]);

  const myId = priv?.playerId ?? sessionRef.current?.playerId ?? null;
  const value = useMemo<GameApi>(() => ({
    connected, restoring, state, priv, chat, reactions, myId, notice, dismissNotice, notify, call,
    createRoom, joinRoom, leaveRoom, ask, pendingAsk, answerAsk,
  }), [connected, restoring, state, priv, chat, reactions, myId, notice, dismissNotice, notify, call, createRoom, joinRoom, leaveRoom, ask, pendingAsk, answerAsk]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
