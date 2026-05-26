// Paint material quantity aggregator (Gap 6).
//
// Pulls interior wall + ceiling area from state.getTotalPaintWallsArea()
// + state.getTotalPaintCeilingArea() (existing) and external-wall area
// from the plaster v2 aggregator (externalWallsFt2) so internal +
// external paint systems can be sized independently.
//
// Per-layer qty = ceil(totalSft × coats / (coverageSftPerGallon × efficiencyFactor))
//   - efficiencyFactor defaulted to 1.0 (Addition 3 reserved field)
//   - rounded up — procurement buys whole gallons
//
// Sandpaper layer uses unitsPerSft instead of coverage.
//
// _meta contract — algorithm/version/scoped/extras.

import {
  getPaintSystem,
  DEFAULT_INTERIOR_PAINT_SYSTEM_ID,
  DEFAULT_EXTERIOR_PAINT_SYSTEM_ID,
} from '../specs/paintSystems.js'
import { computePlasterQuantities } from './plaster.js'
import { buildMeta, ATTRIBUTION_POLICY, isScopedState } from './_metaContract.js'
import { safeR2 as r2 } from '../lib/numbers.js'

const ALGORITHM     = 'PAINT_SYSTEM_LAYER_ROLLUP_V1'
const CALC_VERSION  = '2026-05-26'

function _resolveInteriorSystemId(state) {
  return state?.projectSettings?.defaultInteriorPaintSystemId ?? DEFAULT_INTERIOR_PAINT_SYSTEM_ID
}

function _resolveExteriorSystemId(state) {
  return state?.projectSettings?.defaultExteriorPaintSystemId ?? DEFAULT_EXTERIOR_PAINT_SYSTEM_ID
}

// Per-room override walks state.rooms and groups areas by resolved system.
// For each room with paint=true, system = room.paintSystemId ?? project
// interior default. Ceiling area is per-room (only if paint flag is set).
// Wall area is per-room walls (getRoomWallArea).
function _accumulateInteriorBySystem(state) {
  const bySystem = {}   // { [systemId]: { interiorWallsSft, ceilingSft, rooms: [] } }
  const interiorDefault = _resolveInteriorSystemId(state)
  const rooms = state?.rooms ?? {}
  const validIds = state.getValidRoomIds?.() ?? Object.keys(rooms)
  for (const rid of validIds) {
    const room = rooms[rid]
    if (!room?.finishes?.paint) continue
    const sysId = room.paintSystemId ?? interiorDefault
    if (!bySystem[sysId]) bySystem[sysId] = { interiorWallsSft: 0, ceilingSft: 0, rooms: [] }
    const wallSft    = state.getRoomWallArea?.(rid) ?? 0
    const ceilingSft = state.getRoomArea?.(rid) ?? 0
    bySystem[sysId].interiorWallsSft += wallSft
    bySystem[sysId].ceilingSft       += ceilingSft
    bySystem[sysId].rooms.push({ roomId: rid, name: room.name, wallSft: r2(wallSft), ceilingSft: r2(ceilingSft) })
  }
  return bySystem
}

function _layerQty(layer, totalSft) {
  const eff = layer.efficiencyFactor ?? 1.0
  if (layer.unitsPerSft !== undefined) {
    return { unit: 'nos', qty: Math.ceil(totalSft * layer.unitsPerSft / eff) }
  }
  if (layer.coverageSftPerGallon !== undefined) {
    const coverage = layer.coverageSftPerGallon * eff
    if (coverage <= 0) return { unit: 'gal', qty: 0 }
    return { unit: 'gal', qty: Math.ceil(totalSft * (layer.coats ?? 1) / coverage) }
  }
  return { unit: 'gal', qty: 0 }
}

export function computePaintQuantities(state) {
  if (!state) {
    return {
      bySystem: {}, perLayer: [],
      totals: { interiorWallsSft: 0, ceilingSft: 0, exteriorWallsSft: 0 },
      _meta:  buildMeta({ algorithm: ALGORITHM, calculationVersion: CALC_VERSION,
                          attributionPolicy: ATTRIBUTION_POLICY.OWNING_ROOM, scoped: false }),
    }
  }

  // Interior: per-room override → grouped by resolved system.
  const interiorBySystem = _accumulateInteriorBySystem(state)

  // Exterior: external-wall area from plaster v2 aggregator (single source).
  // Plaster aggregator is pure; safe to call here. We only need totals.externalWallsFt2.
  const plasterQ = computePlasterQuantities(state)
  const exteriorSft = plasterQ.totals.externalWallsFt2 ?? 0
  const exteriorSystemId = _resolveExteriorSystemId(state)

  // Build per-system records (interior systems + 1 exterior system).
  const bySystem = {}
  for (const [sysId, agg] of Object.entries(interiorBySystem)) {
    const sys = getPaintSystem(sysId)
    if (!sys) continue
    const totalSft = agg.interiorWallsSft + agg.ceilingSft
    const layers = sys.layers.map(layer => {
      const q = _layerQty(layer, totalSft)
      return {
        layerId:    layer.id,
        label:      layer.label,
        coats:      layer.coats,
        coverageSftPerGallon: layer.coverageSftPerGallon ?? null,
        unitsPerSft:          layer.unitsPerSft ?? null,
        efficiencyFactor:     layer.efficiencyFactor ?? 1.0,
        totalSft:   r2(totalSft),
        qty:        q.qty,
        unit:       q.unit,
      }
    })
    bySystem[sysId] = {
      systemId:        sysId,
      label:           sys.label,
      appliesContext:  sys.appliesContext,
      interiorWallsSft: r2(agg.interiorWallsSft),
      ceilingSft:       r2(agg.ceilingSft),
      exteriorWallsSft: 0,
      totalSft:         r2(totalSft),
      rooms:            agg.rooms,
      layers,
    }
  }
  if (exteriorSft > 0) {
    const sys = getPaintSystem(exteriorSystemId)
    if (sys) {
      const layers = sys.layers.map(layer => {
        const q = _layerQty(layer, exteriorSft)
        return {
          layerId: layer.id, label: layer.label, coats: layer.coats,
          coverageSftPerGallon: layer.coverageSftPerGallon ?? null,
          unitsPerSft:          layer.unitsPerSft ?? null,
          efficiencyFactor:     layer.efficiencyFactor ?? 1.0,
          totalSft: r2(exteriorSft), qty: q.qty, unit: q.unit,
        }
      })
      // Merge under same systemId if user picked the same system for ext too.
      const existing = bySystem[exteriorSystemId]
      if (existing) {
        existing.exteriorWallsSft = r2(exteriorSft)
        existing.totalSft         = r2(existing.totalSft + exteriorSft)
        // Recompute layers against combined area.
        existing.layers = sys.layers.map(layer => {
          const q = _layerQty(layer, existing.totalSft)
          return {
            layerId: layer.id, label: layer.label, coats: layer.coats,
            coverageSftPerGallon: layer.coverageSftPerGallon ?? null,
            unitsPerSft:          layer.unitsPerSft ?? null,
            efficiencyFactor:     layer.efficiencyFactor ?? 1.0,
            totalSft: existing.totalSft, qty: q.qty, unit: q.unit,
          }
        })
      } else {
        bySystem[exteriorSystemId] = {
          systemId:         exteriorSystemId,
          label:            sys.label,
          appliesContext:   sys.appliesContext,
          interiorWallsSft: 0,
          ceilingSft:       0,
          exteriorWallsSft: r2(exteriorSft),
          totalSft:         r2(exteriorSft),
          rooms:            [],
          layers,
        }
      }
    }
  }

  // Flat per-layer list (one entry per system × layer) — what BOQ emitter consumes.
  const perLayer = []
  for (const sys of Object.values(bySystem)) {
    for (const layer of sys.layers) {
      perLayer.push({
        systemId:   sys.systemId,
        systemLabel: sys.label,
        layerId:    layer.layerId,
        label:      layer.label,
        coats:      layer.coats,
        totalSft:   layer.totalSft,
        qty:        layer.qty,
        unit:       layer.unit,
      })
    }
  }

  // Totals.
  const totals = {
    interiorWallsSft: r2(Object.values(bySystem).reduce((s, v) => s + (v.interiorWallsSft ?? 0), 0)),
    ceilingSft:       r2(Object.values(bySystem).reduce((s, v) => s + (v.ceilingSft ?? 0), 0)),
    exteriorWallsSft: r2(exteriorSft),
  }

  return {
    bySystem,
    perLayer,
    totals,
    _meta: buildMeta({
      algorithm:          ALGORITHM,
      calculationVersion: CALC_VERSION,
      attributionPolicy:  ATTRIBUTION_POLICY.OWNING_ROOM,
      scoped:             isScopedState(state),
      extras: {
        interiorSystemDefault: _resolveInteriorSystemId(state),
        exteriorSystemDefault: exteriorSystemId,
      },
    }),
  }
}
