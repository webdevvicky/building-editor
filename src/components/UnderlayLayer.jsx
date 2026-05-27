// SVG <image> layer for the imported floor-plan PDF/image underlay.
// Phase 4 Tier-2 Step 16. Per-floor as of Fix 3.
//
// Mounted inside Canvas.jsx's <g transform> group, between the group
// opening and the grid rect (lowest visible layer). Pans + zooms with
// the canvas automatically via the parent transform.
//
// The blob lives in IDB (assets.js). We resolve it lazily on first render
// — the state pointer (floors[i].underlay.storageKey) is tiny. Once
// resolved, a module-level Map caches the data URL keyed on storageKey
// to avoid re-reads on every render. Switching floors re-reads the
// pointer for the new floor and shows its blob (or nothing if absent).

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { PX_PER_INCH } from '../geometry'
import { getAsset } from '../projects/storage/assets.js'
import { getAssetStorage } from '../projects/storage/getAssetStorage.js'
import { renderDimensionsInches } from '../underlay/calibration.js'

// World-inches → SVG-group-pixels (matches Canvas.jsx convention).
const sx = x =>  x * PX_PER_INCH
const sy = y => -y * PX_PER_INCH

// Module-level cache — { storageKey → dataUrl }. Cleared by clearUnderlay
// action; the React component just reads here on render.
const _blobCache = new Map()

export function _clearUnderlayBlobCache() { _blobCache.clear() }

function _selectFloorUnderlay(state) {
  const fid = state.currentFloorId
  const floors = state.projectSettings?.floors
  if (!floors) return null
  return floors.find(f => f.id === fid)?.underlay ?? null
}

export default function UnderlayLayer() {
  const underlay = useStore(_selectFloorUnderlay)
  const layerVisibility = useStore(s => s.layerVisibility)
  const [resolved, setResolved] = useState(() => _blobCache.get(underlay?.storageKey) ?? null)

  useEffect(() => {
    let cancelled = false
    if (!underlay?.storageKey) {
      setResolved(null)
      return
    }
    const cached = _blobCache.get(underlay.storageKey)
    if (cached) {
      setResolved(cached)
      return
    }
    ;(async () => {
      const rec = await getAsset(getAssetStorage(), underlay.storageKey)
      if (cancelled) return
      // Prefer dataUrl-style payloads (PDF render path stores them).
      // For File / Blob, build a temporary object URL.
      let dataUrl = null
      if (typeof rec?.blob === 'string') {
        dataUrl = rec.blob
      } else if (rec?.blob instanceof Blob) {
        dataUrl = URL.createObjectURL(rec.blob)
      }
      if (dataUrl) {
        _blobCache.set(underlay.storageKey, dataUrl)
        setResolved(dataUrl)
      }
    })()
    return () => { cancelled = true }
  }, [underlay?.storageKey])

  if (!underlay) return null
  if (!underlay.visible) return null
  if (layerVisibility.underlay === false) return null
  if (!resolved) return null
  if (!underlay.naturalSize) return null

  const { wIn, hIn } = renderDimensionsInches(underlay)
  if (wIn <= 0 || hIn <= 0) return null
  const placement = underlay.placement ?? { xIn: 0, yIn: 0, rotationDeg: 0 }
  const opacity = underlay.opacity ?? 0.35

  // Position rect in world inches → convert to SVG-group pixels. Note Y
  // flip: world Y-up vs SVG Y-down. The image extends DOWN from its
  // anchor point on screen so we use (placement.yIn) as the top edge.
  const xPx = sx(placement.xIn)
  const yPx = sy(placement.yIn + hIn)   // top-edge in screen-space
  const wPx = wIn * PX_PER_INCH
  const hPx = hIn * PX_PER_INCH

  return (
    <g style={{ pointerEvents: 'none' }} data-layer="underlay">
      <image
        href={resolved}
        x={xPx}
        y={yPx}
        width={wPx}
        height={hPx}
        opacity={opacity}
        preserveAspectRatio="none"
      />
    </g>
  )
}
