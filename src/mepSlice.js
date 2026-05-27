// MEP slice — state + actions for 7 entity collections (6 disciplines + risers).
//
// All MEP entities share a common base shape (see CLAUDE.md MEP plan §6.1):
//   { id, floorId, discipline, type, systemId?, systemType?, ifcType?,
//     classificationCode?, meta: null }
//
// The 7 collections:
//   plumbingFixtures, electricalPoints, hvacUnits, fireDevices,
//   elvDevices, solarEquipment, risers
//
// Discipline isolation: each map carries entities of a single discipline.
// Risers are cross-discipline (kind discriminator: PLUMBING_SUPPLY,
// SOIL_STACK, ELECTRICAL_SUBMAIN, ...).
//
// History coverage: every mutator calls get()._save(). The store-level
// _save / undo / redo destructure must include these 7 keys for full
// coverage — handled in store.js, not here.

import { uidIfc } from './lib/ids.js'

const DEFAULT_FLOOR_ID = 'F1'

// Discipline tags per collection, used to stamp entities at creation.
const COLLECTION_DISCIPLINE = {
  plumbingFixtures: 'PLUMBING',
  electricalPoints: 'ELECTRICAL',
  hvacUnits:        'HVAC',
  fireDevices:      'FIRE',
  elvDevices:       'ELV',
  solarEquipment:   'SOLAR',
}

function baseEntity({ uid, discipline, type, x, y, wallId, wallT, floorId }) {
  return {
    id: uid(),
    ifcGlobalId: uidIfc(),
    floorId: floorId ?? DEFAULT_FLOOR_ID,
    discipline,
    type,
    x, y,
    wallId: wallId ?? null,
    wallT:  wallT  ?? null,
    roomId: null,                  // resolved at place-time by the caller (Phase 1A panels)
    rotationDeg: 0,
    systemId: null,
    systemType: null,
    ifcType: null,                 // catalog lookup is wired by Phase 1A panels
    classificationCode: null,
    meta: null,
  }
}

export const createMepSlice = (set, get, uid) => ({

  // ── State (7 entity maps) ────────────────────────────────────────────────

  plumbingFixtures: {},
  electricalPoints: {},
  hvacUnits:        {},
  fireDevices:      {},
  elvDevices:       {},
  solarEquipment:   {},
  risers:           {},

  // ── Selection state (ephemeral; not in history) ──────────────────────────

  selectedPlumbingFixtureId: null,
  selectedElectricalPointId: null,
  selectedHvacUnitId:        null,
  selectedFireDeviceId:      null,
  selectedElvDeviceId:       null,
  selectedSolarEquipmentId:  null,
  selectedRiserId:           null,

  // ── Plumbing fixtures ────────────────────────────────────────────────────

  addPlumbingFixture(type, x, y, wallId, wallT) {
    const fx = {
      ...baseEntity({ uid, discipline: 'PLUMBING', type, x, y, wallId, wallT,
        floorId: get().currentFloorId }),
      hasWaterInlet: null,         // catalog default applied by panel/quantity engine
      hasDrainOutlet: null,
      hasHotWaterInlet: null,
      // Phase 4 Tier-2 Item 26: per-instance flow override (null = catalog default).
      flowLpmOverride: null,
    }
    get()._save()
    set(s => ({ plumbingFixtures: { ...s.plumbingFixtures, [fx.id]: fx } }))
    return fx.id
  },
  updatePlumbingFixture(id, partial) {
    if (!get().plumbingFixtures[id]) return
    get()._save()
    set(s => ({ plumbingFixtures: {
      ...s.plumbingFixtures,
      [id]: { ...s.plumbingFixtures[id], ...partial },
    } }))
  },
  deletePlumbingFixture(id) {
    if (!get().plumbingFixtures[id]) return
    get()._save()
    set(s => {
      const next = { ...s.plumbingFixtures }
      delete next[id]
      return {
        plumbingFixtures: next,
        selectedPlumbingFixtureId: s.selectedPlumbingFixtureId === id ? null : s.selectedPlumbingFixtureId,
      }
    })
  },
  selectPlumbingFixture(id) { set({ selectedPlumbingFixtureId: id }) },

  // ── Electrical points ────────────────────────────────────────────────────

  addElectricalPoint(type, x, y, wallId, wallT) {
    const pt = {
      ...baseEntity({ uid, discipline: 'ELECTRICAL', type, x, y, wallId, wallT,
        floorId: get().currentFloorId }),
      loadW: null,                 // catalog default
      circuitId: null,             // routing engine assigns
      mountHeightFt: null,         // catalog default
      // Phase 4 Tier-2 Item 26: per-instance wire-gauge override (null = catalog default).
      wireGaugeMm2Override: null,
    }
    get()._save()
    set(s => ({ electricalPoints: { ...s.electricalPoints, [pt.id]: pt } }))
    return pt.id
  },
  updateElectricalPoint(id, partial) {
    if (!get().electricalPoints[id]) return
    get()._save()
    set(s => ({ electricalPoints: {
      ...s.electricalPoints,
      [id]: { ...s.electricalPoints[id], ...partial },
    } }))
  },
  deleteElectricalPoint(id) {
    if (!get().electricalPoints[id]) return
    get()._save()
    set(s => {
      const next = { ...s.electricalPoints }
      delete next[id]
      return {
        electricalPoints: next,
        selectedElectricalPointId: s.selectedElectricalPointId === id ? null : s.selectedElectricalPointId,
      }
    })
  },
  selectElectricalPoint(id) { set({ selectedElectricalPointId: id }) },

  // ── HVAC units ───────────────────────────────────────────────────────────

  addHvacUnit(type, x, y, wallId, wallT) {
    const u = {
      ...baseEntity({ uid, discipline: 'HVAC', type, x, y, wallId, wallT,
        floorId: get().currentFloorId }),
      capacityTons: null,
      pairedOutdoorId: null,       // indoor units link to their outdoor pair
      pairedIndoorId: null,
      // Phase 4 Tier-2 Item 24 + Item 26: provenance + override defaults.
      pairingSource: null,
      refrigerantPipeOdInOverride: null,
    }
    get()._save()
    set(s => ({ hvacUnits: { ...s.hvacUnits, [u.id]: u } }))
    return u.id
  },
  updateHvacUnit(id, partial) {
    if (!get().hvacUnits[id]) return
    get()._save()
    set(s => ({ hvacUnits: { ...s.hvacUnits, [id]: { ...s.hvacUnits[id], ...partial } } }))
  },
  deleteHvacUnit(id) {
    if (!get().hvacUnits[id]) return
    get()._save()
    set(s => {
      const next = { ...s.hvacUnits }
      delete next[id]
      return {
        hvacUnits: next,
        selectedHvacUnitId: s.selectedHvacUnitId === id ? null : s.selectedHvacUnitId,
      }
    })
  },
  selectHvacUnit(id) { set({ selectedHvacUnitId: id }) },

  // Phase 4 Tier-2 Item 24: bidirectional HVAC pairing setter.
  // unitId is the unit whose picker the user touched; partnerId is the
  // chosen counterpart (null to unpair). Source defaults to 'MANUAL'
  // — auto-pair handlers pass 'AUTO' explicitly.
  //
  // Handles:
  //   - clearing any prior pairing on BOTH ends (no orphan refs)
  //   - correct field choice per side (indoor → pairedOutdoorId, outdoor → pairedIndoorId)
  //   - source mirrored on both ends
  setHvacPairing(unitId, partnerId, source = 'MANUAL') {
    const state = get()
    const unit = state.hvacUnits[unitId]
    if (!unit) return
    const indoor = unit.type === 'AC_INDOOR_UNIT' || unit.type === 'DUCTED_AC_INDOOR'
    const outdoor = unit.type === 'AC_OUTDOOR_UNIT' || unit.type === 'DUCTED_AC_OUTDOOR'
    if (!indoor && !outdoor) return
    if (partnerId !== null) {
      const partner = state.hvacUnits[partnerId]
      if (!partner) return
      // Side check — pairing must be indoor↔outdoor.
      const partnerIndoor = partner.type === 'AC_INDOOR_UNIT' || partner.type === 'DUCTED_AC_INDOOR'
      const partnerOutdoor = partner.type === 'AC_OUTDOOR_UNIT' || partner.type === 'DUCTED_AC_OUTDOOR'
      if (indoor && !partnerOutdoor) return
      if (outdoor && !partnerIndoor) return
    }
    get()._save()
    set(s => {
      const next = { ...s.hvacUnits }
      // 1. Clear any prior pairing on unit
      const priorPartnerId = indoor ? unit.pairedOutdoorId : unit.pairedIndoorId
      if (priorPartnerId && next[priorPartnerId]) {
        const priorField = indoor ? 'pairedIndoorId' : 'pairedOutdoorId'
        next[priorPartnerId] = { ...next[priorPartnerId], [priorField]: null, pairingSource: null }
      }
      // 2. Clear any prior pairing on new partner
      if (partnerId && next[partnerId]) {
        const partner = next[partnerId]
        const partnerIndoor = partner.type === 'AC_INDOOR_UNIT' || partner.type === 'DUCTED_AC_INDOOR'
        const partnerPriorId = partnerIndoor ? partner.pairedOutdoorId : partner.pairedIndoorId
        if (partnerPriorId && partnerPriorId !== unitId && next[partnerPriorId]) {
          const ppField = partnerIndoor ? 'pairedIndoorId' : 'pairedOutdoorId'
          next[partnerPriorId] = { ...next[partnerPriorId], [ppField]: null, pairingSource: null }
        }
      }
      // 3. Set new pairing
      const unitField = indoor ? 'pairedOutdoorId' : 'pairedIndoorId'
      const partnerField = indoor ? 'pairedIndoorId' : 'pairedOutdoorId'
      next[unitId] = { ...next[unitId], [unitField]: partnerId, pairingSource: partnerId ? source : null }
      if (partnerId) {
        next[partnerId] = { ...next[partnerId], [partnerField]: unitId, pairingSource: source }
      }
      return { hvacUnits: next }
    })
  },

  // ── Fire devices ─────────────────────────────────────────────────────────

  addFireDevice(type, x, y, wallId, wallT) {
    const d = baseEntity({ uid, discipline: 'FIRE', type, x, y, wallId, wallT,
      floorId: get().currentFloorId })
    get()._save()
    set(s => ({ fireDevices: { ...s.fireDevices, [d.id]: d } }))
    return d.id
  },
  updateFireDevice(id, partial) {
    if (!get().fireDevices[id]) return
    get()._save()
    set(s => ({ fireDevices: { ...s.fireDevices, [id]: { ...s.fireDevices[id], ...partial } } }))
  },
  deleteFireDevice(id) {
    if (!get().fireDevices[id]) return
    get()._save()
    set(s => {
      const next = { ...s.fireDevices }
      delete next[id]
      return {
        fireDevices: next,
        selectedFireDeviceId: s.selectedFireDeviceId === id ? null : s.selectedFireDeviceId,
      }
    })
  },
  selectFireDevice(id) { set({ selectedFireDeviceId: id }) },

  // ── ELV devices ──────────────────────────────────────────────────────────

  addElvDevice(type, x, y, wallId, wallT) {
    const d = baseEntity({ uid, discipline: 'ELV', type, x, y, wallId, wallT,
      floorId: get().currentFloorId })
    get()._save()
    set(s => ({ elvDevices: { ...s.elvDevices, [d.id]: d } }))
    return d.id
  },
  updateElvDevice(id, partial) {
    if (!get().elvDevices[id]) return
    get()._save()
    set(s => ({ elvDevices: { ...s.elvDevices, [id]: { ...s.elvDevices[id], ...partial } } }))
  },
  deleteElvDevice(id) {
    if (!get().elvDevices[id]) return
    get()._save()
    set(s => {
      const next = { ...s.elvDevices }
      delete next[id]
      return {
        elvDevices: next,
        selectedElvDeviceId: s.selectedElvDeviceId === id ? null : s.selectedElvDeviceId,
      }
    })
  },
  selectElvDevice(id) { set({ selectedElvDeviceId: id }) },

  // ── Solar equipment ──────────────────────────────────────────────────────

  addSolarEquipment(type, x, y, wallId, wallT) {
    const e = baseEntity({ uid, discipline: 'SOLAR', type, x, y, wallId, wallT,
      floorId: get().currentFloorId })
    get()._save()
    set(s => ({ solarEquipment: { ...s.solarEquipment, [e.id]: e } }))
    return e.id
  },
  updateSolarEquipment(id, partial) {
    if (!get().solarEquipment[id]) return
    get()._save()
    set(s => ({ solarEquipment: { ...s.solarEquipment, [id]: { ...s.solarEquipment[id], ...partial } } }))
  },
  deleteSolarEquipment(id) {
    if (!get().solarEquipment[id]) return
    get()._save()
    set(s => {
      const next = { ...s.solarEquipment }
      delete next[id]
      return {
        solarEquipment: next,
        selectedSolarEquipmentId: s.selectedSolarEquipmentId === id ? null : s.selectedSolarEquipmentId,
      }
    })
  },
  selectSolarEquipment(id) { set({ selectedSolarEquipmentId: id }) },

  // ── Risers (cross-discipline) ────────────────────────────────────────────

  // kind: PLUMBING_SUPPLY | SOIL_STACK | RAINWATER_DOWN | HOT_WATER_RISER |
  //       ELECTRICAL_SUBMAIN | HVAC_REFRIGERANT | HVAC_CONDENSATE |
  //       FIRE_MAIN | ELV_TRUNKING | SOLAR_DC_RISER | SOLAR_AC_RISER
  addRiser({ kind, fromFloorId, toFloorId, x, y, routingZone }) {
    const r = {
      id: uid(),
      ifcGlobalId: uidIfc(),
      kind,
      discipline: (kind || '').split('_')[0],   // crude — refined by suggestions module
      fromFloorId: fromFloorId ?? DEFAULT_FLOOR_ID,
      toFloorId:   toFloorId   ?? fromFloorId ?? DEFAULT_FLOOR_ID,
      x: x ?? 0,
      y: y ?? 0,
      diameterMm: null,        // sizing engine resolves
      routingZone: routingZone ?? 'SHAFT',
      systemId: null,
      ifcType: null,
      classificationCode: null,
      meta: null,
    }
    get()._save()
    set(s => ({ risers: { ...s.risers, [r.id]: r } }))
    return r.id
  },
  updateRiser(id, partial) {
    if (!get().risers[id]) return
    get()._save()
    set(s => ({ risers: { ...s.risers, [id]: { ...s.risers[id], ...partial } } }))
  },
  deleteRiser(id) {
    if (!get().risers[id]) return
    get()._save()
    set(s => {
      const next = { ...s.risers }
      delete next[id]
      return {
        risers: next,
        selectedRiserId: s.selectedRiserId === id ? null : s.selectedRiserId,
      }
    })
  },
  selectRiser(id) { set({ selectedRiserId: id }) },

  // ── MEP defaults application (Phase 1A wiring) ───────────────────────────

  // Apply IS-732 / plumbing / HVAC / fire / ELV defaults to a room.
  // Returns { plumbing: ids[], electrical: ids[], hvac: ids[], fire: ids[],
  // elv: ids[] }. Catalog lookups + suggestion placement live in
  // src/mep/shared/suggestions.js and the discipline suggestion modules —
  // Phase 1A panels call this action with the catalogs already resolved.
  //
  // suggestions: { plumbing?: PlumbingSuggestion[], electrical?: ElectricalSuggestion[],
  //                hvac?: ..., fire?: ..., elv?: ... }
  // where each Suggestion shape = { type, x, y, wallId?, wallT? }.
  applyRoomMepDefaults(roomId, suggestions) {
    const room = get().rooms[roomId]
    if (!room) return { plumbing: [], electrical: [], hvac: [], fire: [], elv: [] }
    const ids = { plumbing: [], electrical: [], hvac: [], fire: [], elv: [] }
    for (const sug of (suggestions.plumbing || [])) {
      ids.plumbing.push(get().addPlumbingFixture(sug.type, sug.x, sug.y, sug.wallId, sug.wallT))
    }
    for (const sug of (suggestions.electrical || [])) {
      ids.electrical.push(get().addElectricalPoint(sug.type, sug.x, sug.y, sug.wallId, sug.wallT))
    }
    for (const sug of (suggestions.hvac || [])) {
      ids.hvac.push(get().addHvacUnit(sug.type, sug.x, sug.y, sug.wallId, sug.wallT))
    }
    for (const sug of (suggestions.fire || [])) {
      ids.fire.push(get().addFireDevice(sug.type, sug.x, sug.y, sug.wallId, sug.wallT))
    }
    for (const sug of (suggestions.elv || [])) {
      ids.elv.push(get().addElvDevice(sug.type, sug.x, sug.y, sug.wallId, sug.wallT))
    }
    return ids
  },

  // Sizing-strategy switcher (Phase 2.6+ wiring; Phase 0 default = CATALOG).
  // projectSettings.mepSizing = { PLUMBING, ELECTRICAL, HVAC, FIRE, SOLAR }
  // Each value is a strategy id from src/mep/shared/sizingStrategy.js.
  setMepSizingStrategy(discipline, strategy) {
    set(s => ({
      projectSettings: {
        ...s.projectSettings,
        mepSizing: { ...(s.projectSettings.mepSizing || {}), [discipline]: strategy },
      },
    }))
  },

  // ── Normalization helpers (used by loadProject) ──────────────────────────

  // Pure: given a parsed MEP map + collection key, returns a normalized
  // version with defaults filled in. Greenfield rule — no migration, just
  // injection of any new fields with sensible defaults.
  _normalizeMepCollection(map, collectionKey) {
    if (!map || typeof map !== 'object') return {}
    const discipline = COLLECTION_DISCIPLINE[collectionKey]
    const out = {}
    for (const [id, e] of Object.entries(map)) {
      out[id] = {
        floorId: DEFAULT_FLOOR_ID,
        discipline,
        wallId: null,
        wallT: null,
        roomId: null,
        rotationDeg: 0,
        systemId: null,
        systemType: null,
        ifcType: null,
        classificationCode: null,
        meta: null,
        // Phase 4 Tier-2 Item 24: HVAC pairingSource provenance. Harmless
        // on other MEP collections (their schemas don't declare the field
        // so validateEntity ignores it).
        pairingSource: null,
        // Phase 4 Tier-2 Item 26 + ADD 2: per-instance MEP overrides.
        // null = catalog default. Discipline-specific; harmless cross-
        // discipline since validateEntity walks schema.fields only.
        flowLpmOverride: null,
        wireGaugeMm2Override: null,
        refrigerantPipeOdInOverride: null,
        ...e,
      }
      if (!out[id].ifcGlobalId) out[id].ifcGlobalId = uidIfc()
    }
    return out
  },

  _normalizeRisers(map) {
    if (!map || typeof map !== 'object') return {}
    const out = {}
    for (const [id, r] of Object.entries(map)) {
      out[id] = {
        fromFloorId: DEFAULT_FLOOR_ID,
        toFloorId:   DEFAULT_FLOOR_ID,
        diameterMm: null,
        routingZone: 'SHAFT',
        systemId: null,
        ifcType: null,
        classificationCode: null,
        meta: null,
        ...r,
      }
      if (!out[id].ifcGlobalId) out[id].ifcGlobalId = uidIfc()
    }
    return out
  },
})
