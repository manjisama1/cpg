import { useEffect, useState, type FormEvent } from 'react';
import { DoorOpen, PlusCircle, TriangleAlert } from 'lucide-react';
import { useGame } from '../game';
import { Avatar } from '../components/Avatar';
import { CharacterPicker } from '../components/CharacterPicker';
import { CHARACTER_COUNT, characterName } from '../characters';
import type { RoomPeek } from '../types';

const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const CODE_LENGTH = 5;

const savedCharacter = (): number => {
  const n = Number(localStorage.getItem('cp.char'));
  return Number.isInteger(n) && n >= 0 && n < CHARACTER_COUNT && localStorage.getItem('cp.char') !== null
    ? n : Math.floor(Math.random() * CHARACTER_COUNT);
};

export default function Home() {
  const g = useGame();
  const [name, setName] = useState(() => localStorage.getItem('cp.name') ?? '');
  const [character, setCharacter] = useState(savedCharacter);
  const [code, setCode] = useState(() => cleanCode(new URLSearchParams(location.search).get('room') ?? ''));
  const [mode, setMode] = useState<'menu' | 'join'>(code ? 'join' : 'menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState<RoomPeek | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [peekTick, setPeekTick] = useState(0); // bump to look at the room again
  const [switched, setSwitched] = useState<string | null>(null);
  const nameOk = name.trim().length > 0;

  // While joining, look at the room so taken characters and names show up before the player hits Join.
  useEffect(() => {
    setPeek(null);
    setPeekError(null);
    if (mode !== 'join' || code.length < CODE_LENGTH) return;
    let stale = false;
    const t = window.setTimeout(async () => {
      const res = await g.call('room:peek', { code }, { silent: true });
      if (stale) return;
      if (res.ok) setPeek({ code: res.code, open: res.open, takenCharacters: res.takenCharacters, takenNames: res.takenNames });
      else setPeekError(res.error?.code === 'room_not_found' ? 'No room with that code. Check it and try again.' : null);
    }, 250);
    return () => { stale = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, code, peekTick]);

  const taken = peek?.takenCharacters ?? [];

  // If someone grabs the character you were on, move to the first free one and say so.
  useEffect(() => {
    if (!taken.includes(character)) return;
    const free = Array.from({ length: CHARACTER_COUNT }, (_, i) => i).find((i) => !taken.includes(i));
    if (free === undefined) return;
    setSwitched(`${characterName(character)} is already taken in this room, so you're now ${characterName(free)}. Tap another one if you like.`);
    setCharacter(free);
  }, [taken, character]);

  const nameTaken = !!peek?.takenNames.some((n) => n.toLowerCase() === name.trim().toLowerCase()) && nameOk;
  const roomClosed = peek !== null && !peek.open;
  const problem = peekError
    ?? (roomClosed ? 'That room is full or the match has already started.' : null)
    ?? (nameTaken ? 'Someone in this room already has that name. Pick another name.' : null)
    ?? error;

  async function run(action: () => ReturnType<typeof g.createRoom>) {
    if (!nameOk || busy) return;
    localStorage.setItem('cp.name', name.trim());
    localStorage.setItem('cp.char', String(character));
    setBusy(true);
    setError(null);
    setSwitched(null);
    const res = await action();
    setBusy(false);
    if (res.ok) { history.replaceState(null, '', location.pathname); return; }
    setError(res.error?.message ?? 'Something went wrong. Please try again.');
    // The room may have changed while we were typing, so refresh what we know about it.
    if (res.error?.code === 'name_taken' || res.error?.code === 'character_taken') setPeekTick((n) => n + 1);
  }
  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (code.length >= 3) void run(() => g.joinRoom(code, name.trim(), character));
  };

  return (
    <main className="home">
      <header className="logo">
        <h1>
          <span className="logo-a">CHOR</span>
          <span className="logo-b">POLICE</span>
        </h1>
        <p className="tagline">Four players. Four roles. One sneaky thief.</p>
        <div className="logo-crew" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <Avatar key={i} character={i} size={72} />)}
        </div>
      </header>

      <section className="card home-card">
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={16} autoComplete="nickname" placeholder="e.g. Sneaky Sam"
            aria-invalid={nameTaken} onChange={(e) => { setName(e.target.value); setError(null); }} />
        </label>

        <CharacterPicker value={character} taken={taken}
          onChange={(i) => { setCharacter(i); setSwitched(null); setError(null); }} disabled={busy} />

        {switched && <p className="hint" role="status">{switched}</p>}

        {mode === 'menu' ? (
          <div className="home-actions">
            {problem && <GameAlert text={problem} />}
            <button className="btn btn-primary btn-big" disabled={!nameOk || busy}
              aria-busy={busy} onClick={() => void run(() => g.createRoom(name.trim(), character))}>
              <PlusCircle aria-hidden="true" /> Create Room
            </button>
            <button className="btn btn-sky btn-big" disabled={!nameOk || busy} onClick={() => { setError(null); setMode('join'); }}>
              <DoorOpen aria-hidden="true" /> Join Room
            </button>
            {!nameOk && <p className="hint">Pick a name to get started.</p>}
          </div>
        ) : (
          <form className="home-actions" onSubmit={onJoin}>
            <label className="field">
              <span>Room code</span>
              <input className="code-input" value={code} inputMode="text" autoCapitalize="characters"
                autoComplete="off" spellCheck={false} placeholder="ABCDE" aria-label="Room code"
                onChange={(e) => { setCode(cleanCode(e.target.value)); setError(null); }} autoFocus />
            </label>
            {problem && <GameAlert text={problem} />}
            <button className="btn btn-sky btn-big" type="submit"
              disabled={!nameOk || code.length < 3 || busy || nameTaken || roomClosed} aria-busy={busy}>
              <DoorOpen aria-hidden="true" /> Join
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setMode('menu'); setError(null); }}>Back</button>
          </form>
        )}
      </section>
    </main>
  );
}

/** Inline alert in the game's own style (used instead of browser pop-ups). */
function GameAlert({ text }: { text: string }) {
  return (
    <div className="game-alert" role="alert">
      <TriangleAlert size={20} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
