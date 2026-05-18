// Topology — foundation ownership selectors.
//
// Fix 1 (Architectural Fixes, 2026-05-16) made the foundation entity the
// authority for the column/wall attachment relationship: foundation.columnIds
// and foundation.wallIds are the single source of truth. There is no
// column.foundationId field.
//
// These pure lookups MOVE here from structuralSlice.js — the store keeps the
// mutators (attachColumnToFoundation etc.) but reads route through topology.

import { createMemo } from './cache.js'

const _columnFoundationIndexMemo = createMemo()

// nodeId-style speed: build a Map<columnId, foundationId> once per
// {foundations} reference. Used by both getFoundationForColumn and
// getColumnIsAttachedToFoundation.
function getColumnToFoundationIndex(state) {
  const foundations = state.foundations
  return _columnFoundationIndexMemo([foundations], () => {
    const out = new Map()
    for (const f of Object.values(foundations)) {
      for (const cid of (f.columnIds || [])) out.set(cid, f.id)
    }
    return out
  })
}

// Returns the foundation that owns columnId, or null. Replaces the linear
// scan that lived in structuralSlice.js.
export function getFoundationForColumn(state, columnId) {
  const fid = getColumnToFoundationIndex(state).get(columnId)
  return fid ? state.foundations[fid] ?? null : null
}

// True if the column appears in any foundation's columnIds[].
export function getColumnIsAttachedToFoundation(state, columnId) {
  return getColumnToFoundationIndex(state).has(columnId)
}

// Returns the first foundation that lists wallId in wallIds[], or null. A
// wall can attach to at most one strip foundation in practice; the plural
// variant handles the rare case of multiple attachments.
export function getFoundationForWall(state, wallId) {
  for (const f of Object.values(state.foundations)) {
    if ((f.wallIds || []).includes(wallId)) return f
  }
  return null
}

export function getFoundationsForWall(state, wallId) {
  return Object.values(state.foundations).filter(f => (f.wallIds || []).includes(wallId))
}

export function getColumnsByFoundation(state, foundationId) {
  const f = state.foundations[foundationId]
  if (!f) return []
  return (f.columnIds || []).map(cid => state.columns[cid]).filter(Boolean)
}

// Column type ids whose inline auto-isolated footings cover unattached
// columns. Useful for BOQ row keying and (eventually) discipline engines
// that want to know which columns DON'T have a custom foundation entity.
export function getInlineFootingColumnTypeIds(state) {
  const attached = getColumnToFoundationIndex(state)
  const types = new Set()
  for (const col of Object.values(state.columns)) {
    if (attached.has(col.id)) continue
    if (col.columnTypeId) types.add(col.columnTypeId)
  }
  return [...types]
}
