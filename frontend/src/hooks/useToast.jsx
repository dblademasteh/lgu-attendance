import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { isInAppEnabled, isInsideQuietWindow } from '../lib/notifPrefs.js';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const push = useCallback((message, type = 'info') => {
    // In-app toggle + quiet hours are user preferences that control whether
    // toasts surface at all. Feed bell state stays independent (user-initiated).
    if (!isInAppEnabled() || isInsideQuietWindow()) return;
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => {
    // Conventions: `const toast = useToast(); toast('msg', 'type')` — callable.
    const toast = (message, type) => push(message, type);
    toast.dismiss = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));
    return toast;
  }, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={value.dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used within ToastProvider');
  return toast;
}

function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="min-w-0">{t.message}</span>
          <button
            type="button"
            className="toast-x"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
