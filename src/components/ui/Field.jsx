import './ui.css';

export function Field({
  label,
  error,
  hint,
  children,
  inline = false,
  required = false,
  className,
}) {
  const classes = [
    'ui-field',
    inline && 'ui-field--inline',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {label && (
        <label className="ui-field__label">
          {label}
          {required && <span className="ui-field__required" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <div className="ui-field__error" role="alert">{error}</div>
      ) : hint ? (
        <div className="ui-field__hint">{hint}</div>
      ) : null}
    </div>
  );
}
