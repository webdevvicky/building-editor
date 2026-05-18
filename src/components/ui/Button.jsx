import './ui.css';

export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled = false,
  onClick,
  children,
  title,
  className,
  ...rest
}) {
  const classes = [
    'ui-btn',
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      onClick={onClick}
      title={title}
      {...rest}
    >
      {children}
    </button>
  );
}
