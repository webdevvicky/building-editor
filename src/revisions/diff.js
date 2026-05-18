// Pure diff functions for revision comparison. No store imports, no React.
//
// Two revisions A and B → structured diff that the UI renders.
// Conventions:
//   - A is the "from" / older revision; B is the "to" / newer revision.
//   - "added" = present in B, absent in A.
//   - "removed" = present in A, absent in B.
//   - "modified" = id present in both, allowlisted fields differ.

// ── Field allowlists per entity type ──────────────────────────────────────
//
// Why allowlists? Each entity carries internal fields (`meta`, `classification`
// today and tomorrow's whatever) that aren't user-meaningful. UUIDs of
// internal references (sourceWallId, parent ids) also shouldn't surface as
// "modifications" unless they reflect real semantic changes. The allowlist
// is the curated public surface for the diff.

const WALL_FIELDS = [
  'n1', 'n2', 'height', 'thickness', 'materialKey',
  'isPlot', 'isVirtual', 'openings',
  'hasPlinthBeam', 'hasLintelBeam', 'hasRoofBeam',
  'floorId',
]

const ROOM_FIELDS = [
  'name', 'type', 'customType', 'wallIds', 'finishes',
  'plasterSystemId', 'floorId',
]

const STAMP_FIELDS = [
  'type', 'x', 'y', 'w', 'h', 'depth', 'name', 'floorId',
]

const COLUMN_FIELDS = [
  'columnTypeId', 'attachedNodeId', 'x', 'y',
  'baseFloorId', 'topFloorId', 'reinforcementSpecId',
]

const BEAM_FIELDS = [
  'endpoints', 'level', 'source', 'sourceWallId',
  'floorId', 'reinforcementSpecId',
]

const SLAB_FIELDS = [
  'type', 'roomIds', 'thicknessIn', 'sinkDepthIn', 'grade',
  'floorId', 'role', 'classification', 'reinforcementSpecId',
]

const STAIRCASE_FIELDS = [
  'type', 'flightCount', 'stepsPerFlight',
  'treadIn', 'riserIn', 'waistSlabIn',
  'landingFtWidth', 'landingFtLength', 'flightWidthFt',
  'grade', 'floorId', 'fromFloorId', 'toFloorId',
]

const FOUNDATION_FIELDS = [
  'type', 'columnIds', 'wallIds', 'geometry', 'grade',
  'pccDepthFt', 'plumDepthFt', 'floorId', 'label',
  'reinforcementSpecId',
]

// Node diff is intentionally minimal — coordinates only. floorIds[] is
// internal topology and usually moves in lockstep with the referencing
// wall, so we omit it from the diff to avoid noise.
const NODE_FIELDS = ['x', 'y']

const ENTITY_SPECS = [
  { key: 'nodes',       label: 'Nodes',       fields: NODE_FIELDS,       floorOf: () => null },
  { key: 'walls',       label: 'Walls',       fields: WALL_FIELDS,       floorOf: e => e.floorId ?? null },
  { key: 'rooms',       label: 'Rooms',       fields: ROOM_FIELDS,       floorOf: e => e.floorId ?? null,
    nameOf: e => e.name },
  { key: 'stamps',      label: 'Stamps',      fields: STAMP_FIELDS,      floorOf: e => e.floorId ?? null,
    nameOf: e => e.name || e.type },
  { key: 'columns',     label: 'Columns',     fields: COLUMN_FIELDS,     floorOf: e => e.baseFloorId ?? null },
  { key: 'beams',       label: 'Beams',       fields: BEAM_FIELDS,       floorOf: e => e.floorId ?? null,
    nameOf: e => e.level || 'beam' },
  { key: 'slabs',       label: 'Slabs',       fields: SLAB_FIELDS,       floorOf: e => e.floorId ?? null,
    nameOf: e => e.role || e.type },
  { key: 'staircases',  label: 'Staircases',  fields: STAIRCASE_FIELDS,  floorOf: e => e.floorId ?? null },
  { key: 'foundations', label: 'Foundations', fields: FOUNDATION_FIELDS, floorOf: e => e.floorId ?? null,
    nameOf: e => e.label || e.type },
]

// Deep-ish equality via JSON serialization. Works for the kinds of values
// stored on entities (numbers, strings, arrays, plain objects). Not for
// functions or class instances — none of those live in state.
function jsonEq(a, b) {
  if (a === b) return true
  try { return JSON.stringify(a) === JSON.stringify(b) }
  catch { return false }
}

function diffEntityMap(mapA, mapB, fields, floorOf, nameOf) {
  const a = mapA || {}
  const b = mapB || {}
  const aIds = new Set(Object.keys(a))
  const bIds = new Set(Object.keys(b))
  const added = []
  const removed = []
  const modified = []

  for (const id of bIds) {
    if (!aIds.has(id)) {
      added.push({ id, floorId: floorOf?.(b[id]) ?? null, name: nameOf?.(b[id]) ?? null, entity: b[id] })
    }
  }
  for (const id of aIds) {
    if (!bIds.has(id)) {
      removed.push({ id, floorId: floorOf?.(a[id]) ?? null, name: nameOf?.(a[id]) ?? null, entity: a[id] })
    }
  }
  for (const id of aIds) {
    if (!bIds.has(id)) continue
    const ea = a[id], eb = b[id]
    const fieldDiffs = []
    for (const f of fields) {
      if (!jsonEq(ea?.[f], eb?.[f])) fieldDiffs.push({ field: f, a: ea?.[f], b: eb?.[f] })
    }
    if (fieldDiffs.length > 0) {
      modified.push({
        id,
        floorId: floorOf?.(eb) ?? floorOf?.(ea) ?? null,
        name:    nameOf?.(eb) ?? nameOf?.(ea) ?? null,
        fields:  fieldDiffs,
      })
    }
  }
  return { added, removed, modified }
}

// Group rows by floorId. Returns Map<floorId, items[]>. floorId === null
// (e.g., nodes) goes into a synthetic "—" bucket.
function groupByFloor(items) {
  const out = new Map()
  for (const it of items) {
    const k = it.floorId ?? '—'
    if (!out.has(k)) out.set(k, [])
    out.get(k).push(it)
  }
  return out
}

// Pure diff of two project snapshots. Each snapshot is the `snapshot` field
// from a RevisionRecord (the version-7 payload).
export function diffProject(snapA, snapB) {
  const out = {}
  for (const spec of ENTITY_SPECS) {
    const { added, removed, modified } = diffEntityMap(
      snapA?.[spec.key], snapB?.[spec.key],
      spec.fields, spec.floorOf, spec.nameOf,
    )
    out[spec.key] = {
      label:        spec.label,
      counts:       { added: added.length, removed: removed.length, modified: modified.length },
      added,
      removed,
      modified,
      // Pre-grouped by floor for the UI's collapsible sections.
      addedByFloor:    groupByFloor(added),
      removedByFloor:  groupByFloor(removed),
      modifiedByFloor: groupByFloor(modified),
    }
  }
  // projectSettings diff: flat field-level pass over a hand-picked surface.
  out.projectSettings = diffProjectSettings(snapA?.projectSettings, snapB?.projectSettings)
  // Aggregate totals across every entity.
  let totalAdded = 0, totalRemoved = 0, totalModified = 0
  for (const spec of ENTITY_SPECS) {
    totalAdded    += out[spec.key].counts.added
    totalRemoved  += out[spec.key].counts.removed
    totalModified += out[spec.key].counts.modified
  }
  out.totals = { added: totalAdded, removed: totalRemoved, modified: totalModified }
  return out
}

// projectSettings is a deeply-nested object — we hand-curate the diff
// paths that matter to a BOQ engineer rather than diff every leaf.
function diffProjectSettings(psA, psB) {
  const a = psA || {}, b = psB || {}
  const paths = [
    ['mortarRatio'],
    ['wastagePercent'],
    ['defaultPlasterSystemId'],
    ['heights', 'plinthHeightFt'],
    ['heights', 'floorHeightFt'],
    ['slabSettings', 'mainThicknessIn'],
    ['slabSettings', 'sunkenDepthIn'],
    ['sunshadeSettings', 'enabled'],
    ['sunshadeSettings', 'projectionFt'],
    ['sunshadeSettings', 'thicknessIn'],
    ['parapetSettings', 'enabled'],
    ['parapetSettings', 'heightFt'],
    ['parapetSettings', 'thicknessIn'],
    ['parapetSettings', 'materialKey'],
    ['staircaseDefaults', 'treadIn'],
    ['staircaseDefaults', 'riserIn'],
    ['staircaseDefaults', 'waistSlabIn'],
    ['foundationDefaults', 'plumDepthFt'],
    ['excavationSettings', 'workingMarginFt'],
    ['excavationSettings', 'bulkDepthFt'],
  ]
  const changes = []
  for (const path of paths) {
    let va = a, vb = b
    for (const seg of path) { va = va?.[seg]; vb = vb?.[seg] }
    if (!jsonEq(va, vb)) changes.push({ path: path.join('.'), a: va, b: vb })
  }
  // Floors[] — diff by floor id.
  const flA = (a.floors || []).reduce((acc, f) => (acc[f.id] = f, acc), {})
  const flB = (b.floors || []).reduce((acc, f) => (acc[f.id] = f, acc), {})
  const FLOOR_FIELDS = ['label', 'sequence', 'plinthHeightFt', 'floorHeightFt']
  const floors = diffEntityMap(flA, flB, FLOOR_FIELDS, () => null, e => e.label)
  // rccSpecs.steelKgPerM3 per element
  const elemA = a.rccSpecs?.steelKgPerM3 || {}
  const elemB = b.rccSpecs?.steelKgPerM3 || {}
  const steelChanges = []
  const keys = new Set([...Object.keys(elemA), ...Object.keys(elemB)])
  for (const k of keys) if (!jsonEq(elemA[k], elemB[k])) steelChanges.push({ element: k, a: elemA[k], b: elemB[k] })
  // columnTypes diff
  const ctA = (a.columnTypes || []).reduce((acc, c) => (acc[c.id] = c, acc), {})
  const ctB = (b.columnTypes || []).reduce((acc, c) => (acc[c.id] = c, acc), {})
  const CT_FIELDS = ['label', 'shape', 'widthIn', 'depthIn', 'diamIn',
                     'footingLengthFt', 'footingWidthFt', 'footingDepthFt',
                     'reinforcementSpecId']
  const columnTypes = diffEntityMap(ctA, ctB, CT_FIELDS, () => null, e => e.label)

  return {
    label:           'Project settings',
    fieldChanges:    changes,
    floors,
    steelKgPerM3:    steelChanges,
    columnTypes,
    counts: {
      fields:  changes.length,
      floors:  floors.counts.added + floors.counts.removed + floors.counts.modified,
      steel:   steelChanges.length,
      columnTypes: columnTypes.counts.added + columnTypes.counts.removed + columnTypes.counts.modified,
    },
  }
}

// Pure diff of two BOQ summaries (see snapshot.js → buildBoqSummary).
// Output is grouped by category for the UI table.
export function diffBoq(summaryA, summaryB) {
  const a = summaryA || { lines: [], totalCost: null }
  const b = summaryB || { lines: [], totalCost: null }
  const aById = new Map(a.lines.map(l => [l.id, l]))
  const bById = new Map(b.lines.map(l => [l.id, l]))
  const ids = new Set([...aById.keys(), ...bById.keys()])

  const byCategory = {}
  for (const id of ids) {
    const la = aById.get(id)
    const lb = bById.get(id)
    const sample = lb || la
    const cat = sample.category
    if (!byCategory[cat]) byCategory[cat] = []
    const qtyA = la?.qty ?? 0
    const qtyB = lb?.qty ?? 0
    const costA = la?.cost ?? null
    const costB = lb?.cost ?? null
    const deltaQty  = Math.round((qtyB - qtyA) * 100) / 100
    const deltaCost = (costA !== null && costB !== null)
      ? Math.round((costB - costA) * 100) / 100
      : (costB ?? costA ?? null)
    const status =
      !la ? 'added' :
      !lb ? 'removed' :
      (Math.abs(deltaQty) > 1e-9) ? 'changed' :
      'unchanged'
    byCategory[cat].push({
      id,
      label: sample.label,
      unit:  sample.unit,
      qtyA, qtyB, deltaQty,
      costA, costB, deltaCost,
      status,
    })
  }
  // Sort each category: changed first, then added, removed, unchanged; by label within.
  const order = { changed: 0, added: 1, removed: 2, unchanged: 3 }
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((x, y) => {
      const so = order[x.status] - order[y.status]
      return so !== 0 ? so : x.label.localeCompare(y.label)
    })
  }
  const totalA = a.totalCost ?? null
  const totalB = b.totalCost ?? null
  const deltaTotal = (totalA !== null && totalB !== null)
    ? Math.round((totalB - totalA) * 100) / 100
    : null
  return { byCategory, totalA, totalB, deltaTotal }
}

// Validation summary diff.
export function diffValidation(va, vb) {
  const a = va || { errors: 0, warnings: 0, info: 0, total: 0, issues: [] }
  const b = vb || { errors: 0, warnings: 0, info: 0, total: 0, issues: [] }
  return {
    countsA: { errors: a.errors, warnings: a.warnings, info: a.info, total: a.total },
    countsB: { errors: b.errors, warnings: b.warnings, info: b.info, total: b.total },
    delta: {
      errors:   b.errors   - a.errors,
      warnings: b.warnings - a.warnings,
      info:     b.info     - a.info,
      total:    b.total    - a.total,
    },
  }
}
