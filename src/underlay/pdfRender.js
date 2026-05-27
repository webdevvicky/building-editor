// Browser-only PDF → PNG converter for underlay import.
// Phase 4 Tier-2 Step 14 + FIX 2 (multi-page page picker, 2026-05-27).
//
// Uses pdfjs-dist via DYNAMIC import so the ~600 KB library only loads
// when the user actually imports a PDF. Image imports (PNG/JPEG) skip
// this module entirely.
//
// Multi-page contract (FIX 2):
//   importUnderlayFile(file, { onMultiPage })
//     - Single-page PDF / image → auto-renders page 1 / decodes image.
//     - Multi-page PDF → onMultiPage({ numPages, thumbnails, choosePage })
//       is invoked. The callback returns a Promise that resolves to the
//       chosen page number (1-indexed) OR null/undefined to cancel.
//       `thumbnails` is an array of { pageNumber, dataUrl, wPx, hPx } at
//       reduced size for the picker UI. `choosePage(n)` is an escape
//       hatch the caller can use instead of `numPages` if they already
//       have the page number from a prior session.
//   importUnderlayFile resolves to:
//     - { kind, dataUrl, wPx, hPx, mimeType, originalFileName, pageNumber? }
//     - null when the user cancelled the picker.

async function _loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString()
  }
  return pdfjs
}

const MAX_EDGE_PX = 4000
const THUMBNAIL_MAX_EDGE_PX = 240

// Render a specific PDF page to a PNG data URL at the given scale.
async function _renderPageToPng(page, longestTargetPx) {
  const baseViewport = page.getViewport({ scale: 1 })
  const longest = Math.max(baseViewport.width, baseViewport.height)
  const scale = longest > longestTargetPx ? longestTargetPx / longest : 2
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return { dataUrl: canvas.toDataURL('image/png'), wPx: canvas.width, hPx: canvas.height }
}

async function _renderThumbnail(page) {
  const baseViewport = page.getViewport({ scale: 1 })
  const longest = Math.max(baseViewport.width, baseViewport.height)
  const scale = THUMBNAIL_MAX_EDGE_PX / longest
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  return { dataUrl: canvas.toDataURL('image/png'), wPx: canvas.width, hPx: canvas.height }
}

// FIX 2 — full multi-page handler. Returns either the chosen page render
// or null when the user cancelled. `pageNumber` defaults to 1 for the
// single-page path and is otherwise resolved by `onMultiPage`.
export async function renderPdfPageToPng(pdfBytes, { onMultiPage, pageNumber } = {}) {
  const pdfjs = await _loadPdfJs()
  const doc = await pdfjs.getDocument({ data: pdfBytes }).promise
  try {
    const numPages = doc.numPages
    let chosen = pageNumber ?? null
    if (chosen == null) {
      if (numPages === 1) {
        chosen = 1
      } else if (typeof onMultiPage === 'function') {
        // Build thumbnails for every page. Sequential render to keep
        // memory bounded — pdfjs reuses the same canvas size cap.
        const thumbnails = []
        for (let i = 1; i <= numPages; i++) {
          const p = await doc.getPage(i)
          const thumb = await _renderThumbnail(p)
          thumbnails.push({ pageNumber: i, ...thumb })
        }
        const choosePage = (n) => {
          chosen = n
        }
        const picked = await onMultiPage({ numPages, thumbnails, choosePage })
        if (chosen == null) chosen = picked
        if (chosen == null) return null   // user cancelled
      } else {
        chosen = 1   // no picker provided — default to page 1
      }
    }
    const page = await doc.getPage(chosen)
    const out = await _renderPageToPng(page, MAX_EDGE_PX)
    return { ...out, pageNumber: chosen, numPages }
  } finally {
    try { await doc.cleanup() } catch { /* swallow */ }
    try { await doc.destroy() } catch { /* swallow */ }
  }
}

// Backwards-compatible single-page helper. Used by Node-side imports
// and any caller that explicitly wants page 1 without the multi-page
// negotiation.
export async function renderPdfFirstPageToPng(pdfBytes) {
  return renderPdfPageToPng(pdfBytes, { pageNumber: 1 })
}

// Read an image File (PNG/JPG/JPEG) into a data URL + natural dimensions.
export function readImageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      const img = new Image()
      img.onload = () => resolve({
        dataUrl,
        wPx: img.naturalWidth,
        hPx: img.naturalHeight,
      })
      img.onerror = () => reject(new Error('Could not decode image'))
      img.src = dataUrl
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Driver — call from the toolbar import handler. Routes by extension /
// MIME type and returns the same shape for both paths. Returns null when
// the user cancels the multi-page picker.
//
// opts: { onMultiPage? } — see renderPdfPageToPng above.
export async function importUnderlayFile(file, opts = {}) {
  const name = (file.name ?? '').toLowerCase()
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
  if (isPdf) {
    const buf = await file.arrayBuffer()
    const out = await renderPdfPageToPng(new Uint8Array(buf), opts)
    if (out == null) return null   // cancelled
    return { kind: 'pdf', ...out, mimeType: 'image/png', originalFileName: file.name }
  }
  const out = await readImageFileToDataUrl(file)
  return { kind: 'image', ...out, mimeType: file.type || 'image/png', originalFileName: file.name }
}
