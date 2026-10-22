import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, Megaphone, Send } from 'lucide-react';
import type { ChatMsg, PublicPlayer } from '../types';
import { Avatar } from './Avatar';

interface Props {
  messages: ChatMsg[];
  players: PublicPlayer[];
  myId: string | null;
  onSend: (text: string) => Promise<boolean>;
  disabled?: boolean;
  disabledText?: string;
}

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Chat({ messages, players, myId, onSend, disabled, disabledText }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastId = useRef(0);
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  const [sending, setSending] = useState(false);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current) setUnread(0);
  };

  // Follow new messages only if the reader is already at the bottom (or wrote the message).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const fresh = messages.filter((m) => m.id > lastId.current);
    lastId.current = messages.length ? messages[messages.length - 1].id : 0;
    if (!fresh.length) return;
    if (atBottom.current || fresh.some((m) => m.playerId === myId)) {
      el.scrollTop = el.scrollHeight;
      setUnread(0);
    } else setUnread((u) => u + fresh.length);
  }, [messages, myId]);

  const jump = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setUnread(0);
  };

  async function submit() {
    const t = text.trim();
    if (!t || sending || disabled) return;
    setSending(true);
    const ok = await onSend(t);
    setSending(false);
    if (ok) setText('');
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const lookOf = (id: string | null) => players.find((p) => p.id === id)?.character ?? 0;

  return (
    <section className="chat card" aria-label="Room chat">
      <div className="chat-list" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" tabIndex={0}>
        {messages.length === 0 && <p className="chat-empty">No messages yet. Say hi!</p>}
        {messages.map((m) =>
          m.kind === 'system' ? (
            <div key={m.id} className="msg msg-system">
              <Megaphone size={16} aria-hidden="true" />
              <span><b className="msg-tag">GAME</b> {m.text}</span>
            </div>
          ) : (
            <div key={m.id} className={`msg msg-chat${m.playerId === myId ? ' mine' : ''}`}>
              <Avatar character={lookOf(m.playerId)} size={32} label={m.name} />
              <div className="msg-body">
                <div className="msg-meta"><b>{m.name}</b> <time>{time(m.ts)}</time></div>
                <div className="msg-text">{m.text}</div>
              </div>
            </div>
          ),
        )}
      </div>
      {unread > 0 && (
        <button className="chat-unread" onClick={jump}>
          <ArrowDown size={16} aria-hidden="true" /> {unread} new
        </button>
      )}
      <div className="chat-compose">
        <textarea
          value={text} rows={1} maxLength={300} disabled={disabled}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          placeholder={disabled ? disabledText ?? 'Chat is closed right now' : 'Type a message…'}
          aria-label="Message"
        />
        <button className="btn btn-sky btn-icon" onClick={() => void submit()} disabled={disabled || sending || !text.trim()} aria-label="Send message">
          <Send size={20} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
