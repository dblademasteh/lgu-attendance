import { useEffect } from 'react';
import { X } from 'lucide-react';

/** lgu-hrms modal spec: persists until explicitly closed (Escape / ✕ /
 * footer). Overlay click does NOT close. Sizes: default `md`, `wide` → `lg`.
 * `footer` renders a `.modal-foot`; forms reference the body via `id`.
 */
export default function Modal({ open, title, onClose, children, wide = false, footer, id }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const size = wide ? 'modal-lg' : 'modal-md';
  return (
    <div className="modal-overlay">
      <div
        className={`modal-box ${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h3 id={id}>{title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}