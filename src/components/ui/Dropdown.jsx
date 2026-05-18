// Dropdown — composable cluster-button + flyout primitive for the toolbar.
//
// Usage:
//   <Dropdown label="Structural & Civil" isActive={true}>
//     <DropdownGroup title="Structural">
//       <DropdownItem icon={ColumnIcon} label="Column" shortcut="C"
//                     active={false} onSelect={() => setTool('column')} />
//     </DropdownGroup>
//   </Dropdown>
//
// Behavior:
//   - Click trigger button → flyout opens beneath, left-aligned.
//   - Click outside flyout OR Escape → flyout closes, focus returns to trigger.
//   - Click a DropdownItem → onSelect fires, flyout closes.
//   - Click a DropdownToggle → onToggle fires, flyout STAYS open.
//   - Window event `toolbar:close-dropdowns` → all dropdowns close (used by
//     useKeyboardShortcuts to keep flyouts in sync with keyboard tool switches).
//
// Reuses: Button primitive (trigger), --color tokens, --shadow-lg,
// --z-overlay, --motion-normal, ui-fade-in animation.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from './Button.jsx'
import './Dropdown.css'

const ICON_SIZE = 14
const ICON_STROKE = 2

export function Dropdown({ label, isActive = false, width, children }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const flyoutRef = useRef(null)

  // Close on outside click, Escape, or external close event.
  useEffect(() => {
    if (!open) return undefined

    function handleClickOutside(e) {
      if (
        flyoutRef.current && !flyoutRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    function handleExternalClose() {
      setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('toolbar:close-dropdowns', handleExternalClose)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('toolbar:close-dropdowns', handleExternalClose)
    }
  }, [open])

  // Children can call closeDropdown() via context — we use a simpler approach:
  // DropdownItem dispatches a 'toolbar:close-dropdowns' event on select.
  // Implemented inside each item to keep the primitive composable.

  return (
    <div className="ui-dropdown">
      <Button
        ref={triggerRef}
        size="sm"
        variant={isActive ? 'primary' : 'ghost'}
        onClick={() => setOpen(o => !o)}
        className="ui-dropdown__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="ui-dropdown__label">{label}</span>
        <ChevronDown
          size={12}
          strokeWidth={ICON_STROKE}
          className={`ui-dropdown__chevron${open ? ' ui-dropdown__chevron--open' : ''}`}
        />
      </Button>
      {open && (
        <div
          ref={flyoutRef}
          className="ui-dropdown__flyout"
          role="menu"
          style={width ? { minWidth: typeof width === 'number' ? `${width}px` : width } : undefined}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function DropdownGroup({ title, children }) {
  return (
    <div className="ui-dropdown__group">
      {title && <div className="ui-dropdown__group-title">{title}</div>}
      <div className="ui-dropdown__group-items">{children}</div>
    </div>
  )
}

export function DropdownDivider() {
  return <div className="ui-dropdown__divider" role="separator" />
}

export function DropdownItem({
  icon: Icon,
  label,
  shortcut,
  active = false,
  disabled = false,
  onSelect,
}) {
  function handleClick() {
    if (disabled) return
    onSelect?.()
    // Close the parent dropdown via window event (decoupled).
    window.dispatchEvent(new CustomEvent('toolbar:close-dropdowns'))
  }
  const classes = [
    'ui-dropdown__item',
    active && 'ui-dropdown__item--active',
    disabled && 'ui-dropdown__item--disabled',
  ].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      className={classes}
      onClick={handleClick}
      disabled={disabled}
      role="menuitem"
    >
      {Icon && (
        <Icon
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className="ui-dropdown__item-icon"
        />
      )}
      <span className="ui-dropdown__item-label">{label}</span>
      {shortcut && (
        <kbd className="ui-dropdown__item-shortcut">{shortcut}</kbd>
      )}
    </button>
  )
}

// Toggle item — does NOT close the dropdown on click.
export function DropdownToggle({
  icon: Icon,
  label,
  checked = false,
  onToggle,
}) {
  return (
    <button
      type="button"
      className="ui-dropdown__item"
      onClick={() => onToggle?.()}
      role="menuitemcheckbox"
      aria-checked={checked}
    >
      {Icon && (
        <Icon
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className="ui-dropdown__item-icon"
        />
      )}
      <span className="ui-dropdown__item-label">{label}</span>
      <span
        className={`ui-dropdown__check${checked ? ' ui-dropdown__check--on' : ''}`}
        aria-hidden="true"
      >
        {checked ? '✓' : ''}
      </span>
    </button>
  )
}

// Segmented control — multiple options, exactly one active, used for unit
// (ft/m). Closes the dropdown when an option is picked.
export function DropdownSegmented({ options, value, onChange }) {
  function handlePick(v) {
    if (v !== value) onChange?.(v)
    window.dispatchEvent(new CustomEvent('toolbar:close-dropdowns'))
  }
  return (
    <div className="ui-dropdown__segmented" role="radiogroup">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`ui-dropdown__segmented-btn${
            value === opt.value ? ' ui-dropdown__segmented-btn--active' : ''
          }`}
          onClick={() => handlePick(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
