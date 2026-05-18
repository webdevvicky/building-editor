// IS-732 circuit grouping rules.
//
// Bins floor's electrical points into circuits per IS-732 / NBC 2016 caps.
// Deterministic: sort points by (roomId, type, id), then walk in order
// filling each circuit bucket until cap reached, then open next.
//
// All caps + wire gauges + MCB ratings flow from catalogs — no magic
// numbers in this module.

import { getPointType } from '../catalogs/pointTypes.js'
import { getWireGauge } from '../catalogs/wireGauges.js'
import { getPointLoadW } from '../catalogs/loads/pointLoads.js'

const DEFAULT_FLOOR_ID = 'F1'

// Per-circuit-class binning policy. Each entry describes:
//   - wireGaugeMm2: the wire used for this circuit
//   - loadCapW: max combined load per circuit (W)
//   - pointCapN: max number of points per circuit (or Infinity)
//   - oneCircuitPerPoint: true ⇒ every matching point gets its own circuit
//
// All values from IS-732 / NBC 2016. Adding a new circuit class = one
// entry here.
const CIRCUIT_POLICY = Object.freeze({
  LIGHTING: Object.freeze({
    wireGaugeMm2: 1.5, loadCapW: 800, pointCapN: 8, oneCircuitPerPoint: false,
  }),
  FAN: Object.freeze({
    wireGaugeMm2: 1.5, loadCapW: 800, pointCapN: 8, oneCircuitPerPoint: false,
  }),
  SOCKETS_5A: Object.freeze({
    wireGaugeMm2: 2.5, loadCapW: 2000, pointCapN: 10, oneCircuitPerPoint: false,
  }),
  SOCKETS_15A: Object.freeze({
    wireGaugeMm2: 2.5, loadCapW: 2000, pointCapN: 6, oneCircuitPerPoint: false,
  }),
  AC: Object.freeze({
    wireGaugeMm2: 4, loadCapW: Infinity, pointCapN: 1, oneCircuitPerPoint: true,
  }),
  GEYSER: Object.freeze({
    wireGaugeMm2: 4, loadCapW: Infinity, pointCapN: 1, oneCircuitPerPoint: true,
  }),
  EV: Object.freeze({
    wireGaugeMm2: 6, loadCapW: Infinity, pointCapN: 1, oneCircuitPerPoint: true,
  }),
})

export function getCircuitPolicy(circuitClass) {
  return CIRCUIT_POLICY[circuitClass] ?? null
}

// Deterministic point comparator: (roomId, type, id).
function _pointCmp(a, b) {
  const ra = a.roomId ?? '', rb = b.roomId ?? ''
  if (ra !== rb) return ra < rb ? -1 : 1
  if (a.type !== b.type) return a.type < b.type ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Given a flat list of points pre-grouped by circuitClass, emit Circuit[]
// per the policy for that class.
function _binByClass(circuitClass, points, floorId) {
  const policy = getCircuitPolicy(circuitClass)
  if (!policy) return []
  const gauge = getWireGauge(policy.wireGaugeMm2)
  if (!gauge) return []

  const sorted = [...points].sort(_pointCmp)
  const circuits = []
  let bucket = null
  let seq = 0

  const newBucket = () => {
    seq += 1
    bucket = {
      id: `circ_${floorId}_${circuitClass}_${String(seq).padStart(2, '0')}`,
      floorId,
      circuitClass,
      gaugeMm2: policy.wireGaugeMm2,
      mcbAmps: gauge.mcbAmps,
      conduitMm: gauge.conduitMm,
      loadCapW: policy.loadCapW,
      pointCapN: policy.pointCapN,
      points: [],
      loadW: 0,
    }
    circuits.push(bucket)
  }

  for (const p of sorted) {
    const loadW = (p.loadW != null && Number.isFinite(p.loadW))
      ? p.loadW
      : getPointLoadW(p.type)
    if (policy.oneCircuitPerPoint) {
      newBucket()
      bucket.points.push(p.id)
      bucket.loadW = loadW
      bucket = null
      continue
    }
    if (!bucket
        || bucket.points.length >= policy.pointCapN
        || bucket.loadW + loadW > policy.loadCapW) {
      newBucket()
    }
    bucket.points.push(p.id)
    bucket.loadW += loadW
  }

  return circuits
}

// Public: build Circuit[] for one floor. Deterministic output order.
export function groupPointsIntoCircuits(state, floorId) {
  if (!state) return []
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const pts = Object.values(state.electricalPoints ?? {})
    .filter(p => p && (p.floorId ?? DEFAULT_FLOOR_ID) === fid)

  // Bucket points by circuitClass (from catalog). DB / SWITCHBOARD /
  // ENERGY_METER / SUB_DB / SOLAR / INVERTER_TIE_POINT / METER points
  // don't bin into circuits.
  const BY_CLASS = new Map()
  for (const p of pts) {
    const cat = getPointType(p.type)
    if (!cat) continue
    const cls = cat.circuitClass
    if (!CIRCUIT_POLICY[cls]) continue
    if (!BY_CLASS.has(cls)) BY_CLASS.set(cls, [])
    BY_CLASS.get(cls).push(p)
  }

  const circuits = []
  for (const cls of [...BY_CLASS.keys()].sort()) {
    circuits.push(..._binByClass(cls, BY_CLASS.get(cls), fid))
  }
  circuits.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return circuits
}

// Public: a tabular summary suitable for the DB schedule.
export function circuitSummary(circuit) {
  return {
    circuitId: circuit.id,
    label:     `${circuit.circuitClass} (${circuit.gaugeMm2} sqmm)`,
    type:      circuit.circuitClass,
    points:    circuit.points.length,
    loadW:     Math.round(circuit.loadW),
    gaugeMm2:  circuit.gaugeMm2,
    mcb:       circuit.mcbAmps,
  }
}
