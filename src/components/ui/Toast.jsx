import { useEffect, useRef, useState } from 'react';
import './ui.css';
import { Button } from './Button.jsx';

let listener = null;
let nextId = 1;
const pendingQueue = [];

function emit(payload) {
  if (listener) {
    listener(payload);
  } else {
    pendingQueue.push(payload);
  }
}

function createToast(level, message, opts = {}) {
  const id = `t${nextId++}`;
  emit({ kind: 'add', toast: { id, level, message, opts } });
  return id;
}

export const toast = {
  success: (message, opts) => createToast('success', message, opts),
  info:    (message, opts) => createToast('info', message, opts),
  warning: (message, opts) => createToast('warning', message, opts),
  error:   (message, opts) => createToast('error', message, opts),
  action:  (message, opts = {}) => createToast('info', message, { ...opts, action: true }),
  dismiss: (id) => emit({ kind: 'dismiss', id }),
  _subscribe(fn) {
    listener = fn;
    // flush any queued toasts emitted before host mounted
    while (pendingQueue.length) fn(pendingQueue.shift());
    return () => {
      if (listener === fn) listener = null;
    };
  },
};

export function ToastHost() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());
  const leavingRef = useRef(new Set());

  useEffect(() => {
    const handler = (event) => {
      if (event.kind === 'add') {
        setToasts((prev) => [...prev, event.toast]);
      } else if (event.kind === 'dismiss') {
        beginDismiss(event.id);
      }
    };
    const unsub = toast._subscribe(handler);
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginDismiss = (id) => {
    if (leavingRef.current.has(id)) return;
    leavingRef.current.add(id);
    const existing = timersRef.current.get(id);
    if (existing) {
      clearTimeout(existing);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    // remove after fade-out (matches --motion-fast = 100ms)
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      leavingRef.current.delete(id);
    }, 110);
  };

  useEffect(() => {
    toasts.forEach((t) => {
      if (t.leaving) return;
      if (timersRef.current.has(t.id)) return;
      const duration = t.opts?.duration === undefined ? 3000 : t.opts.duration;
      if (!duration) return; // sticky
      const handle = setTimeout(() => beginDismiss(t.id), duration);
      timersRef.current.set(t.id, handle);
    });
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts]);

  useEffect(() => () => {
    timersRef.current.forEach((h) => clearTimeout(h));
    timersRef.current.clear();
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="ui-toast-host" role="region" aria-label="Notifications">
      {toasts.map((t) => {
        const cls = ['ui-toast', `ui-toast--${t.level}`, t.leaving && 'ui-toast--leaving']
          .filter(Boolean).join(' ');
        const isAction = t.opts?.action && typeof t.opts?.onClick === 'function';
        return (
          <div
            key={t.id}
            className={cls}
            role={t.level === 'error' || t.level === 'warning' ? 'alert' : 'status'}
          >
            <div className="ui-toast__message">{t.message}</div>
            {isAction && (
              <div className="ui-toast__action">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    try { t.opts.onClick(); } finally { beginDismiss(t.id); }
                  }}
                >
                  {t.opts.label ?? 'Undo'}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
