import { useEffect } from 'react';
import { useGame } from './game';
import Home from './screens/Home';
import Lobby from './screens/Lobby';
import Match from './screens/Match';
import { Avatar } from './components/Avatar';
import { ConfirmHost } from './components/ConfirmHost';
import { HelpButton } from './components/Help';

function Toast() {
  const { notice, dismissNotice } = useGame();
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(dismissNotice, 4000);
    return () => window.clearTimeout(t);
  }, [notice, dismissNotice]);
  return (
    <div className="toast-zone" role="status" aria-live="polite">
      {notice && (
        <button key={notice.id} className={`toast toast-${notice.tone}`} onClick={dismissNotice}>
          {notice.tone === 'error' ? 'Oops: ' : ''}{notice.text}
        </button>
      )}
    </div>
  );
}

export default function App() {
  const g = useGame();
  let screen;
  if (g.restoring) {
    screen = (
      <main className="splash">
        <div className="splash-row">{[0, 1, 2, 3].map((i) => <Avatar key={i} character={i} size={64} />)}</div>
        <p>Rejoining your room…</p>
      </main>
    );
  } else if (!g.state) screen = <Home />;
  else if (g.state.state === 'lobby') screen = <Lobby />;
  else screen = <Match />;

  return (
    <div className="app">
      {!g.connected && (
        <div className="banner" role="status">
          {g.state ? 'Connection lost. Reconnecting…' : 'Connecting to the server…'}
        </div>
      )}
      {screen}
      <Toast />
      <HelpButton />
      <ConfirmHost />
    </div>
  );
}
