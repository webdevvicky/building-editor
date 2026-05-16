// Structural BOQ state slice.
// Usage: spread into the main Zustand create() call.
//   export const useStore = create((set, get) => ({
//     ...existingState,
//     ...createStructuralSlice(set, get, uid),
//   }))
// `uid` is the store-level ID generator (same counter as nodes/walls/rooms/stamps).

import { MATERIAL_LIBRARY, BONDING } from './materials'
import {
  CONCRETE_GRADE, CEMENT_BAGS_PER_M3, STEEL_KG_PER_M3, AGGREGATE_SPLIT,
  SAND_M3_PER_M3_DRY, AGGREGATE_M3_PER_M3_DRY, PCC_BEDDING_THICKNESS_FT,
  BEAM_LEVEL_REGISTRY,
} from './constants/structural'
import { DEFAULT_PLASTER_SYSTEM_ID } from './specs/plasterSystems'
import { getColumnAreaFt2 } from './lib/columnShapes'

// Unit conversion: 1 ft³ = 0.0283168 m³
const FT3_TO_M3 = 0.0283168

function r2(n) { return Math.round(n * 100) / 100 }

// Fix 3: a slab's structural role is derived from its position in the floor stack.
// Top floor → ROOF, intermediate → FLOOR. Sunken/staircase callers override the role.
function inferSlabRole(state, floorId) {
  const floors = state.projectSettings?.floors ?? []
  if (floors.length <= 1) return 'ROOF'
  const sorted = [...floors].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  const idx = sorted.findIndex(f => f.id === floorId)
  return idx === sorted.length - 1 ? 'ROOF' : 'FLOOR'
}

// Module-level memoization caches (reference-equality keyed).
// Safe for single-store apps — one store instance per app lifetime.
let _wallAdjCache    = { rooms: null, result: null }
let _derivedBeamsCache = { walls: null, nodes: null, columns: null, rooms: null, result: null }
let _allBeamsCache   = { beams: null, derived: null, result: null }
let _concreteCache   = { colQ: null, fdnQ: null, beamQ: null, slabQ: null, stairQ: null, sunQ: null, result: null }
let _masonryDedCache = { walls: null, nodes: null, projectSettings: null, result: null }
let _foundationCache = { columns: null, foundations: null, projectSettings: null, colQ: null, result: null }

export const DEFAULT_COLUMN_TYPES = [
  { id: 'C1', label: 'Corner 9×9',    widthIn: 9,  depthIn: 9,  shape: 'rect',   footingLengthFt: 3, footingWidthFt: 3, footingDepthFt: 1    },
  { id: 'C2', label: 'External 9×12', widthIn: 9,  depthIn: 12, shape: 'rect',   footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1    },
  { id: 'C3', label: 'Heavy 12×12',   widthIn: 12, depthIn: 12, shape: 'rect',   footingLengthFt: 5, footingWidthFt: 5, footingDepthFt: 1.25 },
  { id: 'C4', label: 'Circular Φ12',  diamIn: 12,              shape: 'circle', footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1    },
]

export const DEFAULT_FLOOR_ID = 'F1'

export const DEFAULT_FLOORS = [
  { id: DEFAULT_FLOOR_ID, label: 'Floor 1', sequence: 0, plinthHeightFt: 1.5, floorHeightFt: 10, meta: null },
]

export const DEFAULT_PROJECT_SETTINGS = {
  mortarRatio: '1:6',
  wastagePercent: 5,
  plasterThicknessMm: { internal: 12, ceiling: 10, external: 15 },  // legacy; superseded by defaultPlasterSystemId
  defaultPlasterSystemId: DEFAULT_PLASTER_SYSTEM_ID,

  // Floor list — multi-floor expansion lives in floors[]. Phase 1.9 adds the
  // floor switcher UI. heights{} below is retained as the legacy single-floor
  // shortcut and now mirrors floors[0]'s values; new code should iterate floors[].
  floors: DEFAULT_FLOORS,

  heights: {
    plinthHeightFt: 1.5,
    floorHeightFt: 10,
  },

  columnTypes: DEFAULT_COLUMN_TYPES,

  beamDimensions: {
    plinth: { widthIn: 9,  depthIn: 12 },
    lintel: { widthIn: 9,  depthIn: 6  },
    roof:   { widthIn: 9,  depthIn: 15 },
  },

  slabSettings: {
    mainThicknessIn: 5,
    sunkenDepthIn: 4,
    autoSunkenRoomTypes: ['TOILET', 'BALCONY'],
  },

  sunshadeSettings: { enabled: true, projectionFt: 1.5, thicknessIn: 3 },

  parapetSettings: { enabled: true, heightFt: 3.5, thicknessIn: 6, materialKey: 'CONCRETE_SOLID_BLOCK' },

  staircaseDefaults: {
    type: 'DOG_LEGGED',
    treadIn: 10,
    riserIn: 6.5,
    waistSlabIn: 6,
    landingFtWidth: 4,
    landingFtLength: 4,
    flightWidthFt: 3.5,
  },

  // Per-element steel ratios (kg/m³ of RCC). Grade assignment is stored here as data
  // but has no UI selector in this iteration — concrete grade UI deferred to Phase 2.
  rccSpecs: {
    concreteGrade: {
      FOOTING: 'M20', COLUMN: 'M20', BEAM: 'M20', SLAB: 'M20', STAIRCASE: 'M20', PCC: 'M7_5',
    },
    steelKgPerM3: {
      FOOTING: 70, COLUMN: 130, BEAM: 110, SLAB: 90, STAIRCASE: 100, CIVIL_STAMP: 80,
    },
  },

  // Foundation defaults — applied to inline auto-isolated foundations (Phase 1.6e).
  // Foundation entities override these via their own plumDepthFt field.
  foundationDefaults: {
    plumDepthFt: 0,    // 0 = no plum concrete; user can enable per project.
  },
}

// Beam endpoint — discriminated union:
// { type: 'COLUMN', columnId: string }  — position derived from columns[columnId]
// { type: 'POINT',  x: number, y: number } — absolute world coords (inches)
// WALL_DERIVED beams use COLUMN when column exists at node, POINT otherwise.
// EXPLICIT beams always use COLUMN at both ends (user draws column-to-column only).

export const createStructuralSlice = (set, get, uid) => ({

  // ── State ─────────────────────────────────────────────────────────────────

  projectSettings: DEFAULT_PROJECT_SETTINGS,

  // { [id]: { id, x, y, attachedNodeId: string|null, columnTypeId: string } }
  // attachedNodeId null = standalone (draggable); set = follows node position
  columns: {},

  // { [id]: { id, endpoints: { from, to }, level, source, sourceWallId? } }
  // EXPLICIT beams are persisted here; WALL_DERIVED are generated in getDerivedWallBeams().
  beams: {},

  // { [id]: { id, type, roomIds, thicknessIn, sinkDepthIn, grade } }
  slabs: {},

  // { [id]: { id, type, flightCount, stepsPerFlight, treadIn, riserIn,
  //           waistSlabIn, landingFtWidth, landingFtLength, flightWidthFt, grade } }
  // Same id as the companion stairs stamp.
  staircases: {},

  // Foundation entities — first-class for combined / raft / strip / pile (Phase 1.8).
  // Each entry: { id, type, columnIds, wallIds, geometry, grade, pccDepthFt,
  //               plumDepthFt, floorId, label, meta }
  // Empty by default; columns with foundationId=null fall back to inline
  // column-type footing dims (auto-isolated). Behavior identical to pre-T3.
  foundations: {},

  selectedColumnId: null,
  selectedFoundationId: null,

  // ── projectSettings actions ────────────────────────────────────────────────

  setProjectSettings: (partial) => set(state => ({
    projectSettings: { ...state.projectSettings, ...partial },
  })),

  setColumnTypeEntry: (id, fields) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      columnTypes: state.projectSettings.columnTypes.map(ct =>
        ct.id === id ? { ...ct, ...fields } : ct
      ),
    },
  })),

  addColumnType: (fields) => {
    const id = uid()
    set(state => ({
      projectSettings: {
        ...state.projectSettings,
        columnTypes: [
          ...state.projectSettings.columnTypes,
          {
            id,
            label: 'New Type',
            widthIn: 9, depthIn: 9,
            shape: 'rect',
            footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1,
            ...fields,
          },
        ],
      },
    }))
    return id
  },

  removeColumnType: (id) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      columnTypes: state.projectSettings.columnTypes.filter(ct => ct.id !== id),
    },
  })),

  setBeamDimension: (level, fields) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      beamDimensions: {
        ...state.projectSettings.beamDimensions,
        [level]: { ...state.projectSettings.beamDimensions[level], ...fields },
      },
    },
  })),

  setSlabSettings: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      slabSettings: { ...state.projectSettings.slabSettings, ...partial },
    },
  })),

  setSunshadeSettings: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      sunshadeSettings: { ...state.projectSettings.sunshadeSettings, ...partial },
    },
  })),

  setParapetSettings: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      parapetSettings: { ...state.projectSettings.parapetSettings, ...partial },
    },
  })),

  setStaircaseDefaults: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      staircaseDefaults: { ...state.projectSettings.staircaseDefaults, ...partial },
    },
  })),

  setHeights: (partial) => set(state => {
    const nextHeights = { ...state.projectSettings.heights, ...partial }
    // Keep floors[0] in sync with the legacy heights shortcut.
    const floors = (state.projectSettings.floors ?? DEFAULT_FLOORS).map((f, i) =>
      i === 0 ? { ...f, ...partial } : f
    )
    return {
      projectSettings: { ...state.projectSettings, heights: nextHeights, floors },
    }
  }),

  // ── Floor actions ─────────────────────────────────────────────────────────
  // Multi-floor UI lives in Phase 1.9; Stage 0 wires the data plumbing.

  addFloor: (fields = {}) => {
    const id = uid()
    set(state => {
      const existing = state.projectSettings.floors ?? DEFAULT_FLOORS
      const sequence = existing.length
      return {
        projectSettings: {
          ...state.projectSettings,
          floors: [
            ...existing,
            { id, label: `Floor ${sequence + 1}`, sequence, plinthHeightFt: 0, floorHeightFt: 10, meta: null, ...fields },
          ],
        },
      }
    })
    return id
  },

  removeFloor: (id) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      floors: (state.projectSettings.floors ?? DEFAULT_FLOORS).filter(f => f.id !== id),
    },
  })),

  updateFloor: (id, partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      floors: (state.projectSettings.floors ?? DEFAULT_FLOORS).map(f => f.id === id ? { ...f, ...partial } : f),
    },
  })),

  // partial: { steelKgPerM3?: { FOOTING?: number, ... } }
  setRccSpecs: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      rccSpecs: {
        ...state.projectSettings.rccSpecs,
        ...(partial.steelKgPerM3 ? {
          steelKgPerM3: { ...state.projectSettings.rccSpecs.steelKgPerM3, ...partial.steelKgPerM3 },
        } : {}),
      },
    },
  })),

  setFoundationDefaults: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      foundationDefaults: { ...state.projectSettings.foundationDefaults, ...partial },
    },
  })),

  // ── Column actions ─────────────────────────────────────────────────────────

  addColumn: (x, y, columnTypeId, attachedNodeId = null) => {
    const id = uid()
    const floorId = get().currentFloorId ?? DEFAULT_FLOOR_ID
    get()._save()
    set(state => ({
      columns: {
        ...state.columns,
        // Fix 2: baseFloorId + topFloorId (default = current floor — single-floor column).
        // Column height = sum of floor heights from baseFloorId through topFloorId.
        [id]: {
          id, x, y, columnTypeId, attachedNodeId,
          baseFloorId: floorId, topFloorId: floorId,
          classification: null,
          reinforcementSpecId: null,
          meta: null,
        },
      },
    }))
    return id
  },

  deleteColumn: (id) => {
    get()._save()
    set(state => {
      const nextColumns = { ...state.columns }
      delete nextColumns[id]
      // Delete all EXPLICIT beams that reference this column
      const nextBeams = {}
      for (const [bid, beam] of Object.entries(state.beams)) {
        const fromRef = beam.endpoints.from
        const toRef   = beam.endpoints.to
        const fromHit = fromRef.type === 'COLUMN' && fromRef.columnId === id
        const toHit   = toRef.type   === 'COLUMN' && toRef.columnId   === id
        if (!fromHit && !toHit) nextBeams[bid] = beam
      }
      // Fix 1: foundation owns columnIds[]. Removing a column scrubs it from every foundation.
      const nextFoundations = {}
      for (const [fid, f] of Object.entries(state.foundations)) {
        const cids = (f.columnIds || []).filter(cid => cid !== id)
        nextFoundations[fid] = cids.length === (f.columnIds || []).length ? f : { ...f, columnIds: cids }
      }
      return { columns: nextColumns, beams: nextBeams, foundations: nextFoundations }
    })
  },

  setColumnFloorSpan: (id, baseFloorId, topFloorId) => {
    get()._save()
    set(state => ({
      columns: { ...state.columns, [id]: { ...state.columns[id], baseFloorId, topFloorId } },
    }))
  },

  setColumnReinforcementSpec: (id, reinforcementSpecId) => {
    get()._save()
    set(state => ({
      columns: { ...state.columns, [id]: { ...state.columns[id], reinforcementSpecId } },
    }))
  },

  setColumnType: (id, columnTypeId) => {
    get()._save()
    set(state => ({
      columns: { ...state.columns, [id]: { ...state.columns[id], columnTypeId } },
    }))
  },

  detachColumn: (id) => {
    get()._save()
    set(state => ({
      columns: { ...state.columns, [id]: { ...state.columns[id], attachedNodeId: null } },
    }))
  },

  attachColumn: (id, nodeId) => {
    get()._save()
    const node = get().nodes[nodeId]
    set(state => ({
      columns: {
        ...state.columns,
        [id]: {
          ...state.columns[id],
          attachedNodeId: nodeId,
          x: node ? node.x : state.columns[id].x,
          y: node ? node.y : state.columns[id].y,
        },
      },
    }))
  },

  selectColumn: (id) => set({ selectedColumnId: id }),

  // ── Foundation actions ─────────────────────────────────────────────────────
  // Foundation type values: 'ISOLATED' | 'COMBINED' | 'RAFT' | 'STRIP' | 'PILE'.
  // Stage 0 T3 only adds the schema slot + selector fallback; UI lives in Phase 1.8.

  addFoundation: (type, fields = {}) => {
    const id = uid()
    get()._save()
    set(state => ({
      foundations: {
        ...state.foundations,
        [id]: {
          id,
          type,
          columnIds: [],
          wallIds: [],
          geometry: {},
          grade: 'M20',
          pccDepthFt: PCC_BEDDING_THICKNESS_FT,
          plumDepthFt: 0,
          floorId: DEFAULT_FLOOR_ID,   // foundations live below all floors; field present for symmetry
          label: null,
          classification: null,
          meta: null,
          ...fields,
        },
      },
    }))
    return id
  },

  updateFoundation: (id, partial) => {
    get()._save()
    set(state => ({
      foundations: { ...state.foundations, [id]: { ...state.foundations[id], ...partial } },
    }))
  },

  deleteFoundation: (id) => {
    get()._save()
    set(state => {
      const nextFoundations = { ...state.foundations }
      delete nextFoundations[id]
      const nextColumns = {}
      for (const [cid, col] of Object.entries(state.columns)) {
        nextColumns[cid] = col.foundationId === id ? { ...col, foundationId: null } : col
      }
      return { foundations: nextFoundations, columns: nextColumns, selectedFoundationId: null }
    })
  },

  // Fix 1: Foundation owns the relationship. No column.foundationId field.
  // Move column between foundations by editing only the foundations map.
  attachColumnToFoundation: (columnId, foundationId) => {
    get()._save()
    set(state => {
      if (!state.foundations[foundationId] || !state.columns[columnId]) return {}
      const nextFoundations = {}
      for (const [fid, f] of Object.entries(state.foundations)) {
        const had  = (f.columnIds || []).includes(columnId)
        const want = fid === foundationId
        if (want && !had) {
          nextFoundations[fid] = { ...f, columnIds: [...(f.columnIds || []), columnId] }
        } else if (!want && had) {
          nextFoundations[fid] = { ...f, columnIds: (f.columnIds || []).filter(cid => cid !== columnId) }
        } else {
          nextFoundations[fid] = f
        }
      }
      return { foundations: nextFoundations }
    })
  },

  detachColumnFromFoundation: (columnId) => {
    get()._save()
    set(state => {
      const nextFoundations = {}
      for (const [fid, f] of Object.entries(state.foundations)) {
        const cids = (f.columnIds || []).filter(cid => cid !== columnId)
        nextFoundations[fid] = cids.length === (f.columnIds || []).length ? f : { ...f, columnIds: cids }
      }
      return { foundations: nextFoundations }
    })
  },

  attachWallToFoundation: (wallId, foundationId) => {
    get()._save()
    set(state => {
      if (!state.foundations[foundationId] || !state.walls[wallId]) return {}
      const nextFoundations = {}
      for (const [fid, f] of Object.entries(state.foundations)) {
        const had  = (f.wallIds || []).includes(wallId)
        const want = fid === foundationId
        if (want && !had) {
          nextFoundations[fid] = { ...f, wallIds: [...(f.wallIds || []), wallId] }
        } else if (!want && had) {
          nextFoundations[fid] = { ...f, wallIds: (f.wallIds || []).filter(wid => wid !== wallId) }
        } else {
          nextFoundations[fid] = f
        }
      }
      return { foundations: nextFoundations }
    })
  },

  detachWallFromFoundation: (wallId) => {
    get()._save()
    set(state => {
      const nextFoundations = {}
      for (const [fid, f] of Object.entries(state.foundations)) {
        const wids = (f.wallIds || []).filter(wid => wid !== wallId)
        nextFoundations[fid] = wids.length === (f.wallIds || []).length ? f : { ...f, wallIds: wids }
      }
      return { foundations: nextFoundations }
    })
  },

  selectFoundation: (id) => set({ selectedFoundationId: id }),

  // ── Beam actions ───────────────────────────────────────────────────────────

  addBeam: (fromColumnId, toColumnId, level) => {
    const id = uid()
    const state = get()
    // Beam floor = endpoint column's floor (they must match — UI should enforce this; here we trust).
    const floorId = state.columns[fromColumnId]?.floorId
      ?? state.columns[toColumnId]?.floorId
      ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
    state._save()
    set(s => ({
      beams: {
        ...s.beams,
        [id]: {
          id,
          endpoints: {
            from: { type: 'COLUMN', columnId: fromColumnId },
            to:   { type: 'COLUMN', columnId: toColumnId },
          },
          level,
          source: 'EXPLICIT',
          floorId,
          meta: null,
        },
      },
    }))
    return id
  },

  deleteBeam: (id) => {
    get()._save()
    set(state => {
      const next = { ...state.beams }
      delete next[id]
      return { beams: next }
    })
  },

  // ── Slab actions ───────────────────────────────────────────────────────────

  // Fix 3: slab.classification + slab.role (alias) populated on creation.
  // 'SUNKEN' → toilet/balcony, 'ROOF' → top floor, 'FLOOR' → intermediate, 'STAIR_LANDING' → custom.
  addSlab: (type, roomIds, thicknessIn, sinkDepthIn = 0, options = {}) => {
    const id = uid()
    const floorId = options.floorId ?? get().currentFloorId ?? DEFAULT_FLOOR_ID
    const role    = options.role ?? (type === 'SUNKEN' ? 'SUNKEN' : inferSlabRole(get(), floorId))
    get()._save()
    set(state => ({
      slabs: {
        ...state.slabs,
        [id]: {
          id, type, roomIds: [...roomIds], thicknessIn, sinkDepthIn, grade: 'M20',
          floorId,
          classification: role,
          role,
          reinforcementSpecId: null,
          meta: null,
        },
      },
    }))
    return id
  },

  updateSlab: (id, partial) => {
    get()._save()
    set(state => ({
      slabs: { ...state.slabs, [id]: { ...state.slabs[id], ...partial } },
    }))
  },

  deleteSlab: (id) => {
    get()._save()
    set(state => {
      const next = { ...state.slabs }
      delete next[id]
      return { slabs: next }
    })
  },

  assignRoomToSlab: (roomId, targetSlabId) => {
    get()._save()
    set(state => {
      const nextSlabs = {}
      for (const [sid, slab] of Object.entries(state.slabs)) {
        nextSlabs[sid] = {
          ...slab,
          roomIds: sid === targetSlabId
            ? [...new Set([...slab.roomIds, roomId])]
            : slab.roomIds.filter(r => r !== roomId),
        }
      }
      return { slabs: nextSlabs }
    })
  },

  // Called on project load and after first room is added when no slabs exist.
  // Creates one MAIN slab covering all valid rooms, then splits out SUNKEN slabs
  // for rooms whose type matches autoSunkenRoomTypes.
  autoInitSlabs: () => {
    const state = get()
    const validIds = state.getValidRoomIds()
    if (validIds.length === 0) return

    const { mainThicknessIn, sunkenDepthIn, autoSunkenRoomTypes } = state.projectSettings.slabSettings
    const floorId = state.currentFloorId ?? DEFAULT_FLOOR_ID

    const sunkenRoomIds = validIds.filter(id => {
      const room = state.rooms[id]
      return room && autoSunkenRoomTypes.includes(room.type)
    })
    const mainRoomIds = validIds.filter(id => !sunkenRoomIds.includes(id))

    const newSlabs = {}
    const mainRole = inferSlabRole(state, floorId)

    if (mainRoomIds.length > 0) {
      const mainId = uid()
      newSlabs[mainId] = {
        id: mainId, type: 'MAIN', roomIds: mainRoomIds,
        thicknessIn: mainThicknessIn, sinkDepthIn: 0, grade: 'M20',
        floorId, classification: mainRole, role: mainRole,
        reinforcementSpecId: null, meta: null,
      }
    }

    for (const roomId of sunkenRoomIds) {
      const sunkenId = uid()
      newSlabs[sunkenId] = {
        id: sunkenId, type: 'SUNKEN', roomIds: [roomId],
        thicknessIn: mainThicknessIn, sinkDepthIn: sunkenDepthIn, grade: 'M20',
        floorId, classification: 'SUNKEN', role: 'SUNKEN',
        reinforcementSpecId: null, meta: null,
      }
    }

    set({ slabs: newSlabs })
  },

  setSlabRole: (slabId, role) => {
    get()._save()
    set(state => {
      const slab = state.slabs[slabId]
      if (!slab) return {}
      return { slabs: { ...state.slabs, [slabId]: { ...slab, role, classification: role } } }
    })
  },

  setSlabReinforcementSpec: (slabId, reinforcementSpecId) => {
    get()._save()
    set(state => ({
      slabs: { ...state.slabs, [slabId]: { ...state.slabs[slabId], reinforcementSpecId } },
    }))
  },

  // ── Staircase actions ──────────────────────────────────────────────────────

  updateStaircase: (id, fields) => {
    get()._save()
    set(state => ({
      staircases: { ...state.staircases, [id]: { ...state.staircases[id], ...fields } },
    }))
  },

  // ── Wall / opening actions ─────────────────────────────────────────────────

  setWallBeamFlags: (wallId, flags) => {
    get()._save()
    set(state => ({
      walls: { ...state.walls, [wallId]: { ...state.walls[wallId], ...flags } },
    }))
  },

  setOpeningSunshade: (wallId, openingId, hasSunshade) => {
    get()._save()
    set(state => ({
      walls: {
        ...state.walls,
        [wallId]: {
          ...state.walls[wallId],
          openings: state.walls[wallId].openings.map(o =>
            o.id === openingId ? { ...o, hasSunshade } : o
          ),
        },
      },
    }))
  },

  // ── Selectors ─────────────────────────────────────────────────────────────

  // Returns { [wallId]: count } — how many valid rooms reference each wall.
  // Used to auto-classify external (count=1) vs partition (count=2) walls.
  getWallAdjacencyCount: () => {
    const { rooms } = get()
    if (_wallAdjCache.rooms === rooms) return _wallAdjCache.result
    const count = {}
    for (const room of Object.values(rooms)) {
      for (const wid of (room.wallIds || [])) {
        count[wid] = (count[wid] || 0) + 1
      }
    }
    _wallAdjCache = { rooms, result: count }
    return count
  },

  // Resolves null beam flags to auto-derived booleans from room adjacency.
  // External wall (count=1): plinth+lintel+roof; Partition (count=2): lintel only; Unclassified: none.
  classifyWallBeamFlags: (wallId) => {
    const wall = get().walls[wallId]
    if (!wall) {
      return Object.fromEntries(BEAM_LEVEL_REGISTRY.map(lvl => [lvl.flagName, false]))
    }
    const adjCount = get().getWallAdjacencyCount()
    const cnt  = adjCount[wallId] ?? 0
    const isExt  = cnt === 1
    const isPart = cnt === 2
    const result = {}
    for (const lvl of BEAM_LEVEL_REGISTRY) {
      const override = wall[lvl.flagName]
      result[lvl.flagName] = override !== null
        ? override
        : (lvl.autoExternal && isExt) || (lvl.autoPartition && isPart)
    }
    return result
  },

  // Returns in-memory WALL_DERIVED beam entities (NOT persisted in store).
  // Memoized on {walls, nodes, columns, rooms}.
  getDerivedWallBeams: () => {
    const { walls, nodes, columns, rooms } = get()
    const c = _derivedBeamsCache
    if (c.walls === walls && c.nodes === nodes && c.columns === columns && c.rooms === rooms) return c.result

    // Build nodeId → columnId map for attached columns
    const nodeToColId = {}
    for (const col of Object.values(columns)) {
      if (col.attachedNodeId) nodeToColId[col.attachedNodeId] = col.id
    }

    const result = []
    for (const wall of Object.values(walls)) {
      if (wall.isVirtual || wall.isPlot) continue
      const flags = get().classifyWallBeamFlags(wall.id)
      const n1 = nodes[wall.n1], n2 = nodes[wall.n2]
      if (!n1 || !n2) continue

      for (const lvl of BEAM_LEVEL_REGISTRY) {
        if (!flags[lvl.flagName]) continue
        const fromRef = nodeToColId[wall.n1]
          ? { type: 'COLUMN', columnId: nodeToColId[wall.n1] }
          : { type: 'POINT', x: n1.x, y: n1.y }
        const toRef = nodeToColId[wall.n2]
          ? { type: 'COLUMN', columnId: nodeToColId[wall.n2] }
          : { type: 'POINT', x: n2.x, y: n2.y }
        result.push({ id: `derived_${wall.id}_${lvl.id}`, endpoints: { from: fromRef, to: toRef }, level: lvl.id, source: 'WALL_DERIVED', sourceWallId: wall.id })
      }
    }

    _derivedBeamsCache = { walls, nodes, columns, rooms, result }
    return result
  },

  // Merges EXPLICIT (persisted) + WALL_DERIVED (in-memory) beams into one list.
  // All BOQ, canvas render, and CSV export consume this — single code path.
  // Memoized on {beams, derived}.
  getAllBeams: () => {
    const { beams } = get()
    const derived   = get().getDerivedWallBeams()
    const c = _allBeamsCache
    if (c.beams === beams && c.derived === derived) return c.result
    const result = [...Object.values(beams), ...derived]
    _allBeamsCache = { beams, derived, result }
    return result
  },

  // Fix 2: Column height = sum of floor heights from baseFloorId through topFloorId,
  // plus plinth height on the base floor and slab thickness on the top floor.
  // Single-floor column (base === top): plinth + floor + slab thickness (unchanged behavior).
  getColumnHeightFt: (column) => {
    const { projectSettings } = get()
    const { floors = [], slabSettings } = projectSettings
    if (floors.length === 0) {
      // Pre-Stage 0 projects: fall back to legacy heights only.
      const h = projectSettings.heights
      return h.plinthHeightFt + h.floorHeightFt + (slabSettings.mainThicknessIn / 12)
    }
    const sorted = [...floors].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    const baseId = column.baseFloorId ?? sorted[0].id
    const topId  = column.topFloorId  ?? baseId
    const baseIdx = sorted.findIndex(f => f.id === baseId)
    const topIdx  = sorted.findIndex(f => f.id === topId)
    if (baseIdx === -1 || topIdx === -1) {
      const h = projectSettings.heights
      return h.plinthHeightFt + h.floorHeightFt + (slabSettings.mainThicknessIn / 12)
    }
    const lo = Math.min(baseIdx, topIdx), hi = Math.max(baseIdx, topIdx)
    let h = sorted[lo].plinthHeightFt || 0
    for (let i = lo; i <= hi; i++) h += sorted[i].floorHeightFt || 0
    h += slabSettings.mainThicknessIn / 12
    return h
  },

  // Returns { [columnTypeId]: { count, columnHeightFt, sectionFt2, volFt3, label } }
  // Per-column height (Fix 2) — multi-span columns contribute their full span height.
  getColumnQuantities: () => {
    const { columns, projectSettings } = get()
    const { columnTypes } = projectSettings
    const result = {}
    for (const col of Object.values(columns)) {
      const ct = columnTypes.find(t => t.id === col.columnTypeId)
      if (!ct) continue
      const sectionFt2  = getColumnAreaFt2(ct)
      const colHeightFt = get().getColumnHeightFt(col)
      if (!result[ct.id]) result[ct.id] = { count: 0, columnHeightFt: colHeightFt, sectionFt2, volFt3: 0, label: ct.label }
      result[ct.id].count  += 1
      result[ct.id].volFt3 += sectionFt2 * colHeightFt
    }
    for (const k of Object.keys(result)) result[k].volFt3 = r2(result[k].volFt3)
    return result
  },

  // ── Selector discipline (mandatory per task brief) ────────────────────────
  // Centralized relationship/floor selectors. All components and quantity
  // functions go through these — never traverse foundations/columns/walls inline.

  getFoundationForColumn: (columnId) => {
    const { foundations } = get()
    for (const f of Object.values(foundations)) {
      if ((f.columnIds || []).includes(columnId)) return f
    }
    return null
  },

  // A wall can attach to at most one strip foundation in practice, but the data
  // model permits more. Returns the first match (or null) plus a plural variant.
  getFoundationForWall: (wallId) => {
    const { foundations } = get()
    for (const f of Object.values(foundations)) {
      if ((f.wallIds || []).includes(wallId)) return f
    }
    return null
  },

  getFoundationsForWall: (wallId) => {
    const { foundations } = get()
    return Object.values(foundations).filter(f => (f.wallIds || []).includes(wallId))
  },

  getColumnsByFoundation: (foundationId) => {
    const { foundations, columns } = get()
    const f = foundations[foundationId]
    if (!f) return []
    return (f.columnIds || []).map(cid => columns[cid]).filter(Boolean)
  },

  getColumnsOnFloor: (floorId) => {
    // A column belongs to a floor if floorId ∈ [baseFloorId, topFloorId] in sequence order.
    const { columns, projectSettings } = get()
    const floors = [...(projectSettings.floors ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    const idx = floors.findIndex(f => f.id === floorId)
    if (idx === -1) return Object.values(columns).filter(c => c.baseFloorId === floorId)
    return Object.values(columns).filter(col => {
      const baseIdx = floors.findIndex(f => f.id === (col.baseFloorId ?? floorId))
      const topIdx  = floors.findIndex(f => f.id === (col.topFloorId  ?? col.baseFloorId ?? floorId))
      if (baseIdx === -1 || topIdx === -1) return col.baseFloorId === floorId
      const lo = Math.min(baseIdx, topIdx), hi = Math.max(baseIdx, topIdx)
      return idx >= lo && idx <= hi
    })
  },

  getWallsOnFloor: (floorId) => {
    const { walls } = get()
    return Object.values(walls).filter(w => (w.floorId ?? DEFAULT_FLOOR_ID) === floorId)
  },

  getSlabsOnFloor: (floorId) => {
    const { slabs } = get()
    return Object.values(slabs).filter(s => (s.floorId ?? DEFAULT_FLOOR_ID) === floorId)
  },

  getRoomsOnFloor: (floorId) => {
    const { rooms } = get()
    return Object.values(rooms).filter(r => (r.floorId ?? DEFAULT_FLOOR_ID) === floorId)
  },

  getStampsOnFloor: (floorId) => {
    const { stamps } = get()
    return Object.values(stamps).filter(s => (s.floorId ?? DEFAULT_FLOOR_ID) === floorId)
  },

  getBeamsOnFloor: (floorId) => {
    const { beams } = get()
    return Object.values(beams).filter(b => (b.floorId ?? DEFAULT_FLOOR_ID) === floorId)
  },

  getStaircasesOnFloor: (floorId) => {
    // A staircase belongs to its fromFloor and toFloor (visible on both ends).
    const { staircases } = get()
    return Object.values(staircases).filter(sc =>
      (sc.fromFloorId ?? DEFAULT_FLOOR_ID) === floorId ||
      (sc.toFloorId   ?? DEFAULT_FLOOR_ID) === floorId
    )
  },

  // Convenience aggregate — every entity visible on a given floor.
  getEntitiesOnFloor: (floorId) => ({
    walls:      get().getWallsOnFloor(floorId),
    rooms:      get().getRoomsOnFloor(floorId),
    stamps:     get().getStampsOnFloor(floorId),
    columns:    get().getColumnsOnFloor(floorId),
    beams:      get().getBeamsOnFloor(floorId),
    slabs:      get().getSlabsOnFloor(floorId),
    staircases: get().getStaircasesOnFloor(floorId),
  }),

  // Returns { byFoundation, byColumnTypeInline } — combined foundation view.
  //
  // byFoundation:        entries from state.foundations (combined/raft/strip/pile in
  //                      Phase 1.8). Each: { id, type, columnIds, wallIds, floorId,
  //                      concreteVolFt3, pccVolFt3, plumVolFt3, footprintFt2, label, grade }.
  // byColumnTypeInline:  auto-isolated footings for columns with foundationId=null,
  //                      keyed by columnTypeId for backward compatibility with the
  //                      previous getFootingQuantities() shape.
  //
  // Memoized on { columns, foundations, projectSettings, colQ } reference equality.
  getFoundationQuantities: () => {
    const { columns, foundations, projectSettings } = get()
    const { columnTypes } = projectSettings
    const colQ = get().getColumnQuantities()

    const c = _foundationCache
    if (c.columns === columns && c.foundations === foundations && c.projectSettings === projectSettings && c.colQ === colQ)
      return c.result

    // Fix 1: a column is "attached to a foundation" iff its id appears in some
    // foundation.columnIds[]. Inline auto-isolated path covers everything else.
    const attachedSet = new Set()
    for (const f of Object.values(foundations)) {
      for (const cid of (f.columnIds || [])) attachedSet.add(cid)
    }
    const defaultPlumDepthFt = projectSettings.foundationDefaults?.plumDepthFt ?? 0
    const byColumnTypeInline = {}
    for (const ctId of Object.keys(colQ)) {
      const ct = columnTypes.find(t => t.id === ctId)
      if (!ct) continue
      const { footingLengthFt: lFt, footingWidthFt: wFt, footingDepthFt: dFt } = ct
      if (!lFt || !wFt || !dFt) continue
      const count = Object.values(columns).filter(col => col.columnTypeId === ctId && !attachedSet.has(col.id)).length
      if (count === 0) continue
      const footprintFt2 = lFt * wFt
      byColumnTypeInline[ctId] = {
        count,
        concreteVolFt3:  r2(footprintFt2 * dFt * count),
        pccVolFt3:       r2(footprintFt2 * PCC_BEDDING_THICKNESS_FT * count),
        plumVolFt3:      r2(footprintFt2 * defaultPlumDepthFt * count),  // Phase 1.6e
        footprintFt2:    r2(footprintFt2 * count),
        label:           ct.label,
        lengthFt:        lFt,
        widthFt:         wFt,
        depthFt:         dFt,
      }
    }

    // Foundation entity path
    const byFoundation = {}
    for (const [fid, f] of Object.entries(foundations)) {
      const g = f.geometry || {}
      let concreteVolFt3 = 0
      let footprintFt2 = 0
      // Phase 1.8 will flesh these out. Stage 0 T3 supports the common rect-prism cases.
      if (f.type === 'ISOLATED' || f.type === 'COMBINED' || f.type === 'STRIP') {
        const lFt = g.lengthFt || 0, wFt = g.widthFt || 0, dFt = g.depthFt || 0
        footprintFt2   = lFt * wFt
        concreteVolFt3 = footprintFt2 * dFt
      } else if (f.type === 'RAFT') {
        // Raft area = explicit areaFt2 (UI captures from polygon in Phase 1.8) × depth.
        footprintFt2   = g.areaFt2 || 0
        concreteVolFt3 = footprintFt2 * (g.depthFt || 0)
      } else if (f.type === 'PILE') {
        // Pile cap + pile volumes. Phase 1.8 fills the formula.
        footprintFt2   = (g.capLengthFt || 0) * (g.capWidthFt || 0)
        const capVol   = footprintFt2 * (g.capDepthFt || 0)
        const pileCount = g.pilesCount || 0
        const pileVol  = pileCount * Math.PI * Math.pow((g.pileDiamIn || 0) / 24, 2) * (g.pileLengthFt || 0)
        concreteVolFt3 = capVol + pileVol
      }
      const pccDepthFt  = f.pccDepthFt ?? PCC_BEDDING_THICKNESS_FT
      const plumDepthFt = f.plumDepthFt ?? 0
      byFoundation[fid] = {
        id:             fid,
        type:           f.type,
        columnIds:      f.columnIds || [],
        wallIds:        f.wallIds || [],
        floorId:        f.floorId || 'F1',
        concreteVolFt3: r2(concreteVolFt3),
        pccVolFt3:      r2(footprintFt2 * pccDepthFt),
        plumVolFt3:     r2(footprintFt2 * plumDepthFt),
        footprintFt2:   r2(footprintFt2),
        label:          f.label ?? `${f.type} foundation`,
        grade:          f.grade ?? 'M20',
      }
    }

    const result = { byFoundation, byColumnTypeInline }
    _foundationCache = { columns, foundations, projectSettings, colQ, result }
    return result
  },

  // Backward-compatible shape: { [columnTypeId]: { count, concreteVolFt3, pccVolFt3, label, lengthFt, widthFt, depthFt } }
  // Returns only the auto-isolated inline subset. Foundation entities accessed via
  // getFoundationQuantities().byFoundation.
  getFootingQuantities: () => {
    return get().getFoundationQuantities().byColumnTypeInline
  },

  // Returns { plinth: { totalLenFt, widthIn, depthIn, volFt3 }, lintel: {...}, roof: {...} }
  // null entry for a level means no beams of that level exist.
  getBeamQuantities: () => {
    const { columns, nodes, projectSettings } = get()
    const { beamDimensions } = projectSettings
    const allBeams = get().getAllBeams()

    function endpointPos(ref) {
      if (ref.type === 'COLUMN') {
        const col = columns[ref.columnId]
        if (!col) return null
        if (col.attachedNodeId) { const nd = nodes[col.attachedNodeId]; return nd ?? null }
        return { x: col.x, y: col.y }
      }
      return { x: ref.x, y: ref.y }
    }

    const result = Object.fromEntries(BEAM_LEVEL_REGISTRY.map(lvl => [lvl.id, null]))
    for (const beam of allBeams) {
      const dims = beamDimensions[beam.level]
      if (!dims) continue
      const from = endpointPos(beam.endpoints.from)
      const to   = endpointPos(beam.endpoints.to)
      if (!from || !to) continue
      const lenFt = Math.hypot(to.x - from.x, to.y - from.y) / 12
      if (!result[beam.level]) result[beam.level] = { totalLenFt: 0, widthIn: dims.widthIn, depthIn: dims.depthIn, volFt3: 0 }
      result[beam.level].totalLenFt += lenFt
      result[beam.level].volFt3     += lenFt * (dims.widthIn / 12) * (dims.depthIn / 12)
    }
    for (const lvl of BEAM_LEVEL_REGISTRY) {
      if (result[lvl.id]) {
        result[lvl.id].totalLenFt = r2(result[lvl.id].totalLenFt)
        result[lvl.id].volFt3     = r2(result[lvl.id].volFt3)
      }
    }
    return result
  },

  // Returns { mainAreaFt2, mainVolFt3, sunkenAreaFt2, sunkenVolFt3, sunkenRooms }
  // Falls back to auto-deriving from room types when slabs entity is empty (pre-initialization).
  getSlabQuantities: () => {
    const state = get()
    const { projectSettings, slabs, rooms } = state
    const { mainThicknessIn, sunkenDepthIn, autoSunkenRoomTypes } = projectSettings.slabSettings
    const validIds = state.getValidRoomIds()
    const validSet = new Set(validIds)

    let mainAreaFt2 = 0, sunkenAreaFt2 = 0
    const sunkenRooms = []

    if (Object.keys(slabs).length === 0) {
      // Fallback: auto-derive until user or autoInitSlabs sets up slab entities
      for (const rid of validIds) {
        const room = rooms[rid]
        if (!room) continue
        const area = state.getRoomArea(rid)
        if (autoSunkenRoomTypes.includes(room.type)) {
          sunkenAreaFt2 += area
          sunkenRooms.push({ roomId: rid, name: room.name, areaFt2: r2(area) })
        } else {
          mainAreaFt2 += area
        }
      }
    } else {
      for (const slab of Object.values(slabs)) {
        for (const rid of slab.roomIds) {
          if (!validSet.has(rid)) continue
          const area = state.getRoomArea(rid)
          if (slab.type === 'SUNKEN') {
            sunkenAreaFt2 += area
            sunkenRooms.push({ roomId: rid, name: rooms[rid]?.name ?? rid, areaFt2: r2(area) })
          } else {
            mainAreaFt2 += area
          }
        }
      }
    }

    return {
      mainAreaFt2:  r2(mainAreaFt2),
      mainVolFt3:   r2(mainAreaFt2 * mainThicknessIn / 12),
      sunkenAreaFt2: r2(sunkenAreaFt2),
      sunkenVolFt3:  r2(sunkenAreaFt2 * (mainThicknessIn + sunkenDepthIn) / 12),
      sunkenRooms,
    }
  },

  // Returns [{ id, stepCount, waistSlabFt3, landingFt3, totalRccFt3, graniteFt2 }]
  getStaircaseQuantities: () => {
    return Object.values(get().staircases).map(sc => {
      const stepCount  = sc.flightCount * sc.stepsPerFlight
      const riserFt    = sc.riserIn / 12
      const treadFt    = sc.treadIn / 12
      // Waist slab spans hypotenuse of each flight (inclined slab under steps)
      const flightLenFt   = Math.hypot(treadFt * sc.stepsPerFlight, riserFt * sc.stepsPerFlight)
      const waistThickFt  = sc.waistSlabIn / 12
      const waistSlabFt3  = flightLenFt * sc.flightWidthFt * waistThickFt * sc.flightCount
      // Landings between flights (dog-legged: 1 landing per 2 flights, plus top landing)
      const landingCount  = Math.max(1, sc.flightCount)
      const landingFt3    = sc.landingFtWidth * sc.landingFtLength * waistThickFt * landingCount
      const totalRccFt3   = r2(waistSlabFt3 + landingFt3)
      // Granite: tread area × step count + landing areas
      const graniteFt2    = r2(treadFt * sc.flightWidthFt * stepCount + sc.landingFtWidth * sc.landingFtLength * landingCount)
      return { id: sc.id, stepCount, waistSlabFt3: r2(waistSlabFt3), landingFt3: r2(landingFt3), totalRccFt3, graniteFt2 }
    })
  },

  // Returns { count, totalVolFt3 } — aggregates all window openings with hasSunshade=true
  getSunshadeQuantities: () => {
    const { walls, projectSettings } = get()
    const { projectionFt, thicknessIn } = projectSettings.sunshadeSettings
    let count = 0, totalVolFt3 = 0
    for (const wall of Object.values(walls)) {
      for (const op of (wall.openings || [])) {
        if (op.type !== 'window' || !op.hasSunshade) continue
        count++
        totalVolFt3 += projectionFt * (op.width / 12) * (thicknessIn / 12)
      }
    }
    return { count, totalVolFt3: r2(totalVolFt3) }
  },

  // Returns { totalLenFt, heightFt, thicknessIn, totalVolFt3, materialKey }
  // External wall = adjacent to exactly 1 roofing room.
  getParapetQuantities: () => {
    const state = get()
    const { walls, nodes, rooms, projectSettings } = state
    const { enabled, heightFt, thicknessIn, materialKey } = projectSettings.parapetSettings
    if (!enabled) return { totalLenFt: 0, heightFt, thicknessIn, totalVolFt3: 0, materialKey }

    const adjCount     = state.getWallAdjacencyCount()
    const validRoomIds = state.getValidRoomIds()

    // Walls that border at least one roofing room
    const wallBordersRoofing = new Set()
    for (const rid of validRoomIds) {
      const room = rooms[rid]
      if (!room?.finishes?.roofing) continue
      for (const wid of room.wallIds) wallBordersRoofing.add(wid)
    }

    let totalLenFt = 0
    for (const wall of Object.values(walls)) {
      if (wall.isVirtual || wall.isPlot) continue
      if ((adjCount[wall.id] ?? 0) !== 1) continue  // only external
      if (!wallBordersRoofing.has(wall.id)) continue
      const n1 = nodes[wall.n1], n2 = nodes[wall.n2]
      if (!n1 || !n2) continue
      totalLenFt += Math.hypot(n2.x - n1.x, n2.y - n1.y) / 12
    }

    return {
      totalLenFt: r2(totalLenFt),
      heightFt,
      thicknessIn,
      totalVolFt3: r2(totalLenFt * heightFt * (thicknessIn / 12)),
      materialKey,
    }
  },

  // Returns { footing, column, beam, slab, staircase, civilStamp, total } — all in kg
  getSteelQuantities: () => {
    const state = get()
    const steelRatios = state.projectSettings.rccSpecs?.steelKgPerM3 ?? STEEL_KG_PER_M3
    const colQtys  = state.getColumnQuantities()
    const fdnQtys  = state.getFoundationQuantities()
    const beamQtys = state.getBeamQuantities()
    const slabQtys = state.getSlabQuantities()
    const stairQtys = state.getStaircaseQuantities()
    const sumpQty   = state.getSumpCivilQty?.()   ?? { rccBottomFt3: 0, rccTopFt3: 0 }
    const septicQty = state.getSepticCivilQty?.()  ?? { rccBottomFt3: 0, rccTopFt3: 0 }

    const toM3 = ft3 => ft3 * FT3_TO_M3

    const footFt3 =
      Object.values(fdnQtys.byFoundation).reduce((s, q) => s + q.concreteVolFt3, 0) +
      Object.values(fdnQtys.byColumnTypeInline).reduce((s, q) => s + q.concreteVolFt3, 0)
    const footM3  = toM3(footFt3)
    const colM3   = toM3(Object.values(colQtys).reduce((s, q) => s + q.volFt3, 0))
    const beamM3  = toM3(Object.values(beamQtys).filter(Boolean).reduce((s, q) => s + q.volFt3, 0))
    const slabM3  = toM3(slabQtys.mainVolFt3 + slabQtys.sunkenVolFt3)
    const stairM3 = toM3(stairQtys.reduce((s, q) => s + q.totalRccFt3, 0))
    const civilM3 = toM3(sumpQty.rccBottomFt3 + sumpQty.rccTopFt3 + septicQty.rccBottomFt3 + septicQty.rccTopFt3)

    const footing    = Math.round(footM3  * (steelRatios.FOOTING    ?? STEEL_KG_PER_M3.FOOTING))
    const column     = Math.round(colM3   * (steelRatios.COLUMN     ?? STEEL_KG_PER_M3.COLUMN))
    const beam       = Math.round(beamM3  * (steelRatios.BEAM       ?? STEEL_KG_PER_M3.BEAM))
    const slab       = Math.round(slabM3  * (steelRatios.SLAB       ?? STEEL_KG_PER_M3.SLAB))
    const staircase  = Math.round(stairM3 * (steelRatios.STAIRCASE  ?? STEEL_KG_PER_M3.STAIRCASE))
    const civilStamp = Math.round(civilM3 * (steelRatios.CIVIL_STAMP ?? STEEL_KG_PER_M3.CIVIL_STAMP))
    return { footing, column, beam, slab, staircase, civilStamp, total: footing + column + beam + slab + staircase + civilStamp }
  },

  // Returns { M20: { volM3, cementBags, sandM3DRY, agg10mmM3DRY, agg20mmM3DRY },
  //           M7_5: { volM3, cementBags, sandM3DRY, agg20mmM3DRY } }
  // Sand and aggregate are procurement DRY volumes (1.54 factor already embedded in constants).
  // Memoized on selector results (reference equality via intermediate selector refs).
  getConcreteByGrade: () => {
    const state    = get()
    const colQ     = state.getColumnQuantities()
    const fdnQ     = state.getFoundationQuantities()
    const beamQ    = state.getBeamQuantities()
    const slabQ    = state.getSlabQuantities()
    const stairQ   = state.getStaircaseQuantities()
    const sunQ     = state.getSunshadeQuantities()
    const c = _concreteCache
    if (c.colQ === colQ && c.fdnQ === fdnQ && c.beamQ === beamQ && c.slabQ === slabQ && c.stairQ === stairQ && c.sunQ === sunQ) return c.result

    const fdnConcreteFt3 =
      Object.values(fdnQ.byFoundation).reduce((s, q) => s + q.concreteVolFt3, 0) +
      Object.values(fdnQ.byColumnTypeInline).reduce((s, q) => s + q.concreteVolFt3, 0)

    const m20Ft3 =
      Object.values(colQ).reduce((s, q) => s + q.volFt3, 0) +
      fdnConcreteFt3 +
      Object.values(beamQ).filter(Boolean).reduce((s, q) => s + q.volFt3, 0) +
      slabQ.mainVolFt3 + slabQ.sunkenVolFt3 +
      stairQ.reduce((s, q) => s + q.totalRccFt3, 0) +
      sunQ.totalVolFt3

    const pccFt3 =
      Object.values(fdnQ.byFoundation).reduce((s, q) => s + q.pccVolFt3, 0) +
      Object.values(fdnQ.byColumnTypeInline).reduce((s, q) => s + q.pccVolFt3, 0)
    const m20M3  = m20Ft3 * FT3_TO_M3
    const pccM3  = pccFt3 * FT3_TO_M3

    const result = {}
    if (m20M3 > 0) {
      result['M20'] = {
        volM3:        r2(m20M3),
        cementBags:   Math.ceil(m20M3 * CEMENT_BAGS_PER_M3.M20),
        sandM3DRY:    r2(m20M3 * SAND_M3_PER_M3_DRY.M20),
        agg10mmM3DRY: r2(m20M3 * AGGREGATE_M3_PER_M3_DRY.M20 * AGGREGATE_SPLIT.M20.mm10Ratio),
        agg20mmM3DRY: r2(m20M3 * AGGREGATE_M3_PER_M3_DRY.M20 * AGGREGATE_SPLIT.M20.mm20Ratio),
      }
    }
    if (pccM3 > 0) {
      result['M7_5'] = {
        volM3:        r2(pccM3),
        cementBags:   Math.ceil(pccM3 * CEMENT_BAGS_PER_M3.M7_5),
        sandM3DRY:    r2(pccM3 * SAND_M3_PER_M3_DRY.M7_5),
        agg20mmM3DRY: r2(pccM3 * AGGREGATE_M3_PER_M3_DRY.M7_5),  // 20mm only for M7.5 PCC
      }
    }

    _concreteCache = { colQ, fdnQ, beamQ, slabQ, stairQ, sunQ, result }
    return result
  },

  // Returns same shape as getMaterialQuantities() but with beam volumes deducted.
  // Beam deduction per wall = Σ over active beam levels of:
  //   wallLengthFt × min(wallThicknessFt, beamWidthFt) × beamDepthFt
  //
  // Beam deduction is per-wall approximation: wallLength × beam-width × beam-depth.
  // May slightly over-deduct at beam junctions and corners. Acceptable for contractor
  // BOQ estimation; absorbed by wastage allowance. Not exact structural netting.
  //
  // Memoized on {walls, nodes, projectSettings}.
  getMasonryWithBeamDeduction: () => {
    const { walls, nodes, projectSettings } = get()
    const c = _masonryDedCache
    if (c.walls === walls && c.nodes === nodes && c.projectSettings === projectSettings) return c.result

    const base = get().getMaterialQuantities?.()
    if (!base || Object.keys(base).length === 0) {
      _masonryDedCache = { walls, nodes, projectSettings, result: base ?? {} }
      return base ?? {}
    }

    const { beamDimensions, wastagePercent } = projectSettings
    const WASTAGE = 1 + wastagePercent / 100

    // Accumulate deductions per material key
    const deductions = {}
    for (const wall of Object.values(walls)) {
      if (wall.isVirtual || wall.isPlot) continue
      const matKey = wall.materialKey ?? 'IS_MODULAR_BRICK'
      const flags  = get().classifyWallBeamFlags(wall.id)
      const n1 = nodes[wall.n1], n2 = nodes[wall.n2]
      if (!n1 || !n2) continue
      const wallLenFt  = Math.hypot(n2.x - n1.x, n2.y - n1.y) / 12
      const wallThickFt = (wall.thickness ?? 9) / 12
      let deductFt3 = 0
      for (const lvl of BEAM_LEVEL_REGISTRY) {
        if (!flags[lvl.flagName]) continue
        const dims = beamDimensions[lvl.id]
        if (!dims) continue
        deductFt3 += wallLenFt * Math.min(wallThickFt, dims.widthIn / 12) * (dims.depthIn / 12)
      }
      if (deductFt3 > 0) deductions[matKey] = (deductions[matKey] ?? 0) + deductFt3
    }

    if (Object.keys(deductions).length === 0) {
      _masonryDedCache = { walls, nodes, projectSettings, result: base }
      return base
    }

    const result = {}
    for (const [matKey, qty] of Object.entries(base)) {
      const deduct = deductions[matKey] ?? 0
      if (deduct === 0) { result[matKey] = qty; continue }

      const adjustedVol = Math.max(0, qty.volFt3 - deduct)
      const ratio = qty.volFt3 > 0 ? adjustedVol / qty.volFt3 : 0
      const mat = MATERIAL_LIBRARY[matKey]

      if (!mat) { result[matKey] = { ...qty, volFt3: r2(adjustedVol) }; continue }

      const unitsPer   = mat.bricksPerFt3 ?? mat.blocksPerFt3 ?? 0
      const unitCount  = Math.ceil(adjustedVol * unitsPer * WASTAGE)
      const adjusted   = { ...qty, volFt3: r2(adjustedVol), unitCount }

      if (mat.bondingType === BONDING.CEMENT_SAND) {
        const mortarVol = adjustedVol * mat.mortarVolPerFt3Wall
        adjusted.cementBags = Math.ceil(mortarVol * mat.cementBagsPerFt3Mortar)
        adjusted.sandFt3    = r2(mortarVol * mat.sandFt3PerFt3Mortar)
      } else {
        // THIN_BED: adhesive scales proportionally with volume ratio
        adjusted.adhesiveKg   = r2((qty.adhesiveKg ?? 0) * ratio)
        adjusted.adhesiveBags = Math.ceil(adjusted.adhesiveKg / (mat.adhesiveBagKg ?? 40))
      }
      result[matKey] = adjusted
    }

    _masonryDedCache = { walls, nodes, projectSettings, result }
    return result
  },
})
