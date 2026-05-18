import './ui.css';
import { Button } from './Button.jsx';

export function Panel({
  title,
  onClose,
  width = 280,
  position = { top: 56, left: 16 },
  zIndex,
  children,
  footer,
  className,
}) {
  const style = {
    position: 'absolute',
    width: typeof width === 'number' ? `${width}px` : width,
    ...position,
  };
  if (zIndex !== undefined) style.zIndex = zIndex;

  const classes = ['ui-panel', className].filter(Boolean).join(' ');

  return (
    <div className={classes} style={style} role="region" aria-label={typeof title === 'string' ? title : undefined}>
      {(title || onClose) && (
        <div className="ui-panel__header">
          <div className="ui-panel__title">{title}</div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} title="Close" aria-label="Close">
              ×
            </Button>
          )}
        </div>
      )}
      <div className="ui-panel__body">{children}</div>
      {footer && <div className="ui-panel__footer">{footer}</div>}
    </div>
  );
}
