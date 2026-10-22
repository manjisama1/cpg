import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The game's own dialog: same card look as everything else, so nothing ever
 * falls back to the browser's grey alert boxes.
 */
export function Modal({ title, titleId, role = 'dialog', onClose, children, footer, wide = false }: {
  title: ReactNode;
  titleId: string;
  role?: 'dialog' | 'alertdialog';
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Put focus on the first button inside the panel (the safe choice comes first).
    panel.current?.querySelector<HTMLElement>('button')?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      before?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} className={`modal card${wide ? ' modal-wide' : ''}`} role={role} aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
