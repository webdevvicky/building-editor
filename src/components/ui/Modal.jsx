import { useEffect, useRef } from 'react';
import './ui.css';
import { Button } from './Button.jsx';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  width = 480,
  children,
  footer,
}) {
  const boxRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current = document.activeElement;

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === 'Tab' && boxRef.current) {
        const focusables = boxRef.current.querySelectorAll(FOCUSABLE);
        const visible = Array.from(focusables).filter(
          (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
        );
        if (visible.length === 0) {
          e.preventDefault();
          return;
        }
        const first = visible[0];
        const last = visible[visible.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);

    // focus first focusable after mount
    queueMicrotask(() => {
      if (!boxRef.current) return;
      const focusables = boxRef.current.querySelectorAll(FOCUSABLE);
      const first = Array.from(focusables).find(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
      );
      if (first) first.focus();
      else boxRef.current.focus();
    });

    return () => {
      document.removeEventListener('keydown', handleKey);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleBackdrop = () => onClose?.();
  const stop = (e) => e.stopPropagation();

  return (
    <div className="ui-modal-backdrop" onMouseDown={handleBackdrop}>
      <div
        ref={boxRef}
        className="ui-modal"
        style={{ width: `${width}px` }}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        onMouseDown={stop}
      >
        {(title || onClose) && (
          <div className="ui-modal__header">
            <div className="ui-modal__title">{title}</div>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose} title="Close" aria-label="Close">
                ×
              </Button>
            )}
          </div>
        )}
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
