import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { Modal } from './Modal';

const POINTS: { role: string; right: string; wrong: string }[] = [
  { role: 'Officer', right: '+50', wrong: '-20' },
  { role: 'Police', right: '+30', wrong: '-15' },
  { role: 'Daket', right: '-15', wrong: '+15' },
  { role: 'Chor', right: '-10', wrong: '+10' },
];

/** Help is available from the home screen, clear of the in-room chat and controls. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button className="help-fab" onClick={() => setOpen(true)} aria-label="How to play" aria-haspopup="dialog">
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <Modal title="How to play" titleId="help-title" onClose={close} wide
          footer={<button className="btn btn-primary" onClick={close}><X size={18} aria-hidden="true" /> Got it</button>}>
          <div className="help">
            <p>
              Four players, one room. Every round you each get a secret role, and after the last round
              the player with the most points wins.
            </p>

            <h3>The roles</h3>
            <ul>
              <li><b>Officer</b> starts the round by choosing who the Police must find, the Chor or the Daket.</li>
              <li><b>Police</b> raises a hand next, then has to figure out who the Officer meant.</li>
              <li><b>Daket</b> and <b>Chor</b> stay hidden. Keep quiet or bluff, whatever keeps you out of trouble.</li>
            </ul>

            <h3>How a round goes</h3>
            <ol>
              <li>The Officer raises a hand and gives the order.</li>
              <li>The Police raises a hand too. Both of them now show as verified, so you know those two are real.</li>
              <li>Everyone talks in the chat. Anybody can claim anything there, so don't take it at face value. If three players vote to skip, the talking stops early.</li>
              <li>The Police taps the player they think fits the order and confirms. There is no taking it back.</li>
              <li>If the Police runs out of time, they lose points and the Officer gets one last guess.</li>
            </ol>

            <h3>Points</h3>
            <div className="table-scroll">
              <table className="help-table">
                <thead>
                  <tr><th scope="col">Role</th><th scope="col">Police is right</th><th scope="col">Police is wrong</th></tr>
                </thead>
                <tbody>
                  {POINTS.map((r) => (
                    <tr key={r.role}>
                      <th scope="row">{r.role}</th>
                      <td className={r.right.startsWith('+') ? 'up' : 'down'}>{r.right}</td>
                      <td className={r.wrong.startsWith('+') ? 'up' : 'down'}>{r.wrong}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              If the Police times out they lose 20. The Officer's last guess is worth +10 if it's right and -30 if it's wrong.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
