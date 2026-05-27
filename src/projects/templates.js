// Project template store (Area 2C Step 8).
//
// Templates are MODEL-ONLY snapshots (Correction 7) saved in IDB under
// DB_STORES.TEMPLATES. A user can save the current project as a template
// then spawn fresh projects from it; the rewriter regenerates every
// internal id + ifcGlobalId so the clone's journal/history stays separate.
//
// FK authority (Correction 8): the rewriter walks FK_DESCRIPTORS from
// src/schema/integrity.js. Adding a new FK to the verifier without
// adding the descriptor leaves a dangling reference after clone, which
// scripts/verify-templates.mjs catches via verifyIntegrity.
//
// What templates EXCLUDE (per Correction 7):
//   - history / future (undo ring buffers)
//   - selection state (selectedWallId / selectedOpening / selection.*)
//   - hover state (hoveredWallId — Canvas-local but documented)
//   - activeTool / drawStartId / pendingWallIds / drawVirtual
//   - memo caches / derived aggregates / boqRevision / ratesRevision
//   - transient UI flags (showDimensions / layerVisibility / dragMode etc.)
//   - revision journals (each project has its own audit trail)
//   - validationEvents ring buffer
// buildSnapshot() already produces a model-only shape (see src/projects/_snapshot.js).

import { uid, newEntityIds } from '../lib/ids.js'
import { FK_DESCRIPTORS } from '../schema/integrity.js'
import { DB_STORES } from './storage/indexedDb.js'

const TEMPLATES_BROADCAST = 'boq-templates'

let _storage = null
let _broadcast = null

function _isBrowser() {
  return typeof globalThis !== 'undefined'
    && typeof globalThis.window !== 'undefined'
}

export function _setTemplateStorage(storage) {
  _storage = storage
  // BroadcastChannel — browser-only. Node verify scripts skip to avoid
  // keeping the event loop open (mirrors src/projects/manager.js).
  if (_isBrowser() && typeof globalThis.BroadcastChannel === 'function') {
    try { _broadcast = new globalThis.BroadcastChannel(TEMPLATES_BROADCAST) } catch { /* noop */ }
  }
}

function _notify(kind, payload) {
  try { _broadcast?.postMessage({ kind, ...payload }) } catch { /* noop */ }
}

// ── Path helpers ────────────────────────────────────────────────────────
// Dot-path getter that supports nested FK fields like 'endpoints.from.columnId'.
function _getPath(obj, path) {
  const parts = path.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

// Immutable dot-path setter. Returns a NEW object with the path replaced;
// containers on the path are shallow-cloned.
function _setPath(obj, path, value) {
  const parts = path.split('.')
  if (parts.length === 1) return { ...obj, [parts[0]]: value }
  const [head, ...rest] = parts
  const child = obj?.[head]
  return { ...obj, [head]: _setPath(child ?? {}, rest.join('.'), value) }
}

// ── Snapshot pruning (Correction 7 — model only) ─────────────────────────
// buildSnapshot() in _snapshot.js already produces a model-only shape, but
// freshly include the explicit version stamp + dropping accidental
// transient fields callers might have left in.
function _pruneToModel(snapshot) {
  const out = {
    version:          snapshot.version ?? 7,
    nodes:            snapshot.nodes            ?? {},
    walls:            snapshot.walls            ?? {},
    rooms:            snapshot.rooms            ?? {},
    stamps:           snapshot.stamps           ?? {},
    columns:          snapshot.columns          ?? {},
    beams:            snapshot.beams            ?? {},
    slabs:            snapshot.slabs            ?? {},
    staircases:       snapshot.staircases       ?? {},
    foundations:      snapshot.foundations      ?? {},
    plumbingFixtures: snapshot.plumbingFixtures ?? {},
    electricalPoints: snapshot.electricalPoints ?? {},
    hvacUnits:        snapshot.hvacUnits        ?? {},
    fireDevices:      snapshot.fireDevices      ?? {},
    elvDevices:       snapshot.elvDevices       ?? {},
    solarEquipment:   snapshot.solarEquipment   ?? {},
    risers:           snapshot.risers           ?? {},
    ratesByKey:       snapshot.ratesByKey       ?? {},
    projectSettings:  snapshot.projectSettings  ?? null,
  }
  return out
}

// Collections we rewrite IDs in (skip 'ratesByKey' — keyed by string, not ID).
const ENTITY_COLLECTIONS = Object.freeze([
  'nodes', 'walls', 'rooms', 'stamps', 'columns', 'beams', 'slabs',
  'staircases', 'foundations',
  'plumbingFixtures', 'electricalPoints', 'hvacUnits',
  'fireDevices', 'elvDevices', 'solarEquipment', 'risers',
])

// ── ID remap + FK rewriter (Correction 8 — driven by FK_DESCRIPTORS) ────
export function buildIdRemap(snapshot) {
  const remap = {}      // { collectionName: { oldId: newId } }
  for (const coll of ENTITY_COLLECTIONS) {
    remap[coll] = {}
    const m = snapshot[coll] ?? {}
    for (const id of Object.keys(m)) {
      const { id: newId } = newEntityIds()
      remap[coll][id] = newId
    }
  }
  return remap
}

export function rewriteSnapshot(snapshot, remap) {
  const pruned = _pruneToModel(snapshot)
  const out = { ...pruned }

  // ── Stamp every entity with new id + ifcGlobalId, keyed by NEW id ──
  for (const coll of ENTITY_COLLECTIONS) {
    const sourceMap = pruned[coll] ?? {}
    const collRemap = remap[coll] ?? {}
    const next = {}
    for (const [oldId, entity] of Object.entries(sourceMap)) {
      const newId = collRemap[oldId] ?? oldId
      const { ifcGlobalId } = newEntityIds()
      next[newId] = { ...entity, id: newId, ifcGlobalId }
    }
    out[coll] = next
  }

  // ── Walk FK_DESCRIPTORS, rewrite every reference ──────────────────────
  for (const desc of FK_DESCRIPTORS) {
    const targetRemap = remap[desc.target] ?? {}
    const coll = out[desc.collection] ?? {}
    const updated = {}
    for (const [id, entity] of Object.entries(coll)) {
      // Gate (e.g. beam endpoints.from.columnId only follows when type === 'COLUMN').
      if (desc.gateField && _getPath(entity, desc.gateField) !== desc.gateValue) {
        updated[id] = entity
        continue
      }
      const oldVal = _getPath(entity, desc.field)
      if (oldVal == null) { updated[id] = entity; continue }
      if (desc.isArray) {
        if (!Array.isArray(oldVal)) { updated[id] = entity; continue }
        const newVal = oldVal.map(v => targetRemap[v] ?? v)
        updated[id] = _setPath(entity, desc.field, newVal)
      } else {
        const newVal = targetRemap[oldVal] ?? oldVal
        updated[id] = _setPath(entity, desc.field, newVal)
      }
    }
    out[desc.collection] = updated
  }

  // ── Rewrite nested opening collections inside walls ───────────────────
  // Openings live inside wall.openings[] with their own opening.id +
  // ifcGlobalId. Regenerate so cloned project's audit trail stays clean.
  const wallsWithNewOpenings = {}
  for (const [wid, wall] of Object.entries(out.walls ?? {})) {
    if (!Array.isArray(wall.openings) || wall.openings.length === 0) {
      wallsWithNewOpenings[wid] = wall
      continue
    }
    wallsWithNewOpenings[wid] = {
      ...wall,
      openings: wall.openings.map(op => {
        const fresh = newEntityIds()
        return { ...op, id: fresh.id, ifcGlobalId: op.ifcGlobalId ? fresh.ifcGlobalId : op.ifcGlobalId }
      }),
    }
  }
  out.walls = wallsWithNewOpenings

  return out
}

// ── Public API ──────────────────────────────────────────────────────────

export async function saveCurrentAsTemplate(name, snapshot) {
  if (!_storage) throw new Error('Template storage not initialized')
  const trimmed = (name && String(name).trim()) || 'Untitled template'
  const { id, ifcGlobalId } = newEntityIds()
  const rec = {
    id, ifcGlobalId, name: trimmed, kind: 'user',
    createdAt: Date.now(),
    snapshot:  _pruneToModel(snapshot),
  }
  await _storage.put(DB_STORES.TEMPLATES, id, rec)
  _notify('template-saved', { id })
  return { id, name: trimmed, kind: 'user', createdAt: rec.createdAt }
}

export async function listTemplates() {
  if (!_storage) return []
  const all = (await _storage.getAll(DB_STORES.TEMPLATES)) ?? []
  return all
    .map(t => ({ id: t.id, name: t.name, kind: t.kind ?? 'user', createdAt: t.createdAt ?? 0 }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

export async function getTemplate(id) {
  if (!_storage) return null
  return (await _storage.get(DB_STORES.TEMPLATES, id)) ?? null
}

export async function deleteTemplate(id) {
  if (!_storage) return false
  await _storage.delete(DB_STORES.TEMPLATES, id)
  _notify('template-deleted', { id })
  return true
}

export async function renameTemplate(id, name) {
  if (!_storage) return false
  const rec = await _storage.get(DB_STORES.TEMPLATES, id)
  if (!rec) return false
  rec.name = (name && String(name).trim()) || rec.name
  await _storage.put(DB_STORES.TEMPLATES, id, rec)
  _notify('template-renamed', { id })
  return true
}

// Produces a rewritten snapshot ready to be passed to loadProject(...).
// Callers create a fresh project (createProject) FIRST so the in-memory
// store has a clean slate, then call loadProject on the result of this
// function. The returned snapshot has data.projectSettings populated, so
// loadProject's new-project detection (data.projectSettings == null)
// does NOT fire — the template's dimensionMode + every other setting
// flows through as-is.
export async function createSnapshotFromTemplate(templateId) {
  const tmpl = await getTemplate(templateId)
  if (!tmpl) return null
  const remap = buildIdRemap(tmpl.snapshot)
  return rewriteSnapshot(tmpl.snapshot, remap)
}
