import { useEffect, useRef, useState } from 'react';
import './ui.css';
import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';
import { Field } from './Field.jsx';

let listener = null;
let pendingWarned = false;

function emit(payload) {
  if (listener) {
    listener(payload);
    return true;
  }
  if (!pendingWarned) {
    pendingWarned = true;
    // eslint-disable-next-line no-console
    console.warn('[Dialog] No DialogHost mounted; falling back to native dialogs.');
  }
  return false;
}

export const dialog = {
  alert(message, opts = {}) {
    return new Promise((resolve) => {
      const ok = emit({ type: 'alert', message, opts, resolve });
      if (!ok) {
        // eslint-disable-next-line no-alert
        window.alert(message);
        resolve();
      }
    });
  },
  confirm(message, opts = {}) {
    return new Promise((resolve) => {
      const ok = emit({ type: 'confirm', message, opts, resolve });
      if (!ok) {
        // eslint-disable-next-line no-alert
        resolve(window.confirm(message));
      }
    });
  },
  prompt(message, opts = {}) {
    return new Promise((resolve) => {
      const ok = emit({ type: 'prompt', message, opts, resolve });
      if (!ok) {
        // eslint-disable-next-line no-alert
        resolve(window.prompt(message, opts?.defaultValue ?? ''));
      }
    });
  },
  _subscribe(fn) {
    listener = fn;
    return () => {
      if (listener === fn) listener = null;
    };
  },
};

export function DialogHost() {
  const [current, setCurrent] = useState(null);
  const [promptValue, setPromptValue] = useState('');
  const queueRef = useRef([]);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (payload) => {
      queueRef.current.push(payload);
      setCurrent((prev) => prev ?? queueRef.current.shift());
    };
    const unsub = dialog._subscribe(handler);
    return unsub;
  }, []);

  useEffect(() => {
    if (current?.type === 'prompt') {
      setPromptValue(current.opts?.defaultValue ?? '');
    }
  }, [current]);

  const finish = (result) => {
    current?.resolve(result);
    const next = queueRef.current.shift() ?? null;
    setCurrent(next);
  };

  const handleClose = () => {
    if (!current) return;
    if (current.type === 'confirm') finish(false);
    else if (current.type === 'prompt') finish(null);
    else finish(undefined);
  };

  if (!current) return null;

  const opts = current.opts || {};
  const title = opts.title ?? defaultTitle(current.type);
  const confirmLabel = opts.confirmLabel ?? 'OK';
  const cancelLabel = opts.cancelLabel ?? 'Cancel';
  const confirmVariant = opts.variant === 'danger' ? 'danger' : 'primary';

  let footer;
  if (current.type === 'alert') {
    footer = (
      <Button variant="primary" size="md" onClick={() => finish(undefined)} autoFocus>
        {confirmLabel}
      </Button>
    );
  } else if (current.type === 'confirm') {
    footer = (
      <>
        <Button variant="secondary" size="md" onClick={() => finish(false)}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} size="md" onClick={() => finish(true)} autoFocus>
          {confirmLabel}
        </Button>
      </>
    );
  } else {
    footer = (
      <>
        <Button variant="secondary" size="md" onClick={() => finish(null)}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} size="md" onClick={() => finish(promptValue)}>
          {confirmLabel}
        </Button>
      </>
    );
  }

  return (
    <Modal open={true} onClose={handleClose} title={title} width={420} footer={footer}>
      {current.message && <p className="ui-dialog__message">{current.message}</p>}
      {current.type === 'prompt' && (
        <Field label={opts.fieldLabel}>
          <input
            ref={inputRef}
            type="text"
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finish(promptValue);
              }
            }}
            autoFocus
          />
        </Field>
      )}
    </Modal>
  );
}

function defaultTitle(type) {
  if (type === 'confirm') return 'Confirm';
  if (type === 'prompt') return 'Input';
  return 'Notice';
}
