// PDF page picker — FIX 2 (2026-05-27).
//
// Subscribes to the `underlay:page-picker` window event dispatched by
// Toolbar.handleUnderlayImport when the user imports a multi-page PDF.
// Receives { numPages, thumbnails, resolve } in the event detail; calls
// `resolve(pageNumber)` on selection or `resolve(null)` on cancel.
//
// Decoupled via window event so the Toolbar handler doesn't need to
// import this component, mirroring the boq:toggle / toolbar:close-dropdowns
// pattern documented in CLAUDE.md.

import { useEffect, useState } from 'react'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'

export default function PDFPagePickerModal() {
  const [request, setRequest] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    function onRequest(ev) {
      setRequest(ev.detail)
      setSelected(1)
    }
    window.addEventListener('underlay:page-picker', onRequest)
    return () => window.removeEventListener('underlay:page-picker', onRequest)
  }, [])

  if (!request) return null

  const { numPages, thumbnails, resolve } = request

  function close(pickedPage) {
    try { resolve(pickedPage ?? null) } catch { /* swallow */ }
    setRequest(null)
    setSelected(null)
  }

  return (
    <Modal
      open
      onClose={() => close(null)}
      title={`Choose floor-plan page (${numPages} pages)`}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(null)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!selected}
            onClick={() => close(selected)}
          >
            Use page {selected ?? '—'}
          </Button>
        </>
      }
    >
      <div style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-secondary)',
        marginBottom: 'var(--space-3)',
        lineHeight: 1.5,
      }}>
        This PDF has {numPages} pages. Pick the page that contains the
        floor plan you want to use as the underlay. The selected page
        renders at full resolution; other pages are discarded.
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 'var(--space-2)',
        maxHeight: 420,
        overflowY: 'auto',
        padding: 'var(--space-1)',
      }}>
        {thumbnails.map(t => {
          const active = t.pageNumber === selected
          return (
            <button
              key={t.pageNumber}
              onClick={() => setSelected(t.pageNumber)}
              onDoubleClick={() => close(t.pageNumber)}
              title={`Page ${t.pageNumber}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-1)',
                padding: 'var(--space-2)',
                border: active
                  ? '2px solid var(--color-primary)'
                  : '1px solid var(--color-border)',
                background: active ? 'var(--color-primary-bg)' : 'var(--color-surface)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
                fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                color: active ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
                transition: 'all var(--motion-fast) var(--ease-out)',
              }}
            >
              <img
                src={t.dataUrl}
                alt={`Page ${t.pageNumber}`}
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: 160,
                  objectFit: 'contain',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
              <span>Page {t.pageNumber}</span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
