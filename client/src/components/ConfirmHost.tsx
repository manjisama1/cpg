import { useGame } from '../game';
import { Modal } from './Modal';

/** Renders whatever the game asked for through g.ask(). Mounted once in App. */
export function ConfirmHost() {
  const { pendingAsk: a, answerAsk } = useGame();
  if (!a) return null;
  return (
    <Modal title={a.title} titleId="ask-title" role="alertdialog" onClose={() => answerAsk(false)}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => answerAsk(false)}>{a.cancelText ?? 'Cancel'}</button>
          <button className={`btn ${a.tone === 'danger' ? 'btn-coral' : 'btn-primary'}`} onClick={() => answerAsk(true)}>
            {a.confirmText ?? 'OK'}
          </button>
        </>
      }>
      <p>{a.message}</p>
    </Modal>
  );
}
