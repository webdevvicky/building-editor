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
import {
  DEFAULT_INTERIOR_PAINT_SYSTEM_ID,
  DEFAULT_EXTERIOR_PAINT_SYSTEM_ID,
} from './specs/paintSystems'
import { DEFAULT_CEILING_FINISH_SYSTEM_ID } from './specs/ceilingFinishSystems'
import {
  DEFAULT_DOOR_HARDWARE_DEFAULTS,
  DEFAULT_WINDOW_HARDWARE_DEFAULTS,
} from './specs/hardware/hardwareSets'
import { DEFAULT_PROJECT_COSTS } from './boq/projectCosts'
import { buildDefaultTargetSettings } from './snap/targets.js'
import { STANDARD_BAR_LENGTH_M } from './specs/reinforcementSpecs'
import { getColumnAreaFt2 } from './lib/columnShapes'
import { createMemo } from './topology/cache.js'
import {
  getNodesOnFloor as topoGetNodesOnFloor,
  getWallsOnFloor as topoGetWallsOnFloor,
  getRoomsOnFloor as topoGetRoomsOnFloor,
  getStampsOnFloor as topoGetStampsOnFloor,
  getBeamsOnFloor as topoGetBeamsOnFloor,
  getSlabsOnFloor as topoGetSlabsOnFloor,
  getStaircasesOnFloor as topoGetStaircasesOnFloor,
  getColumnsOnFloor as topoGetColumnsOnFloor,
  getNodeIdsOnFloor as topoGetNodeIdsOnFloor,
  getWallIdsOnFloor as topoGetWallIdsOnFloor,
  getEntitiesOnFloor as topoGetEntitiesOnFloor,
} from './topology/floor.js'
import {
  getWallAdjacencyCount as topoGetWallAdjacencyCount,
  classifyWallBeamFlags as topoClassifyWallBeamFlags,
} from './topology/walls.js'
import {
  resolveBeamEndpoint as topoResolveBeamEndpoint,
  getDerivedWallBeams as topoGetDerivedWallBeams,
  getAllBeams as topoGetAllBeams,
} from './topology/beams.js'
import {
  getColumnHeightFt as topoGetColumnHeightFt,
  getColumnSpanFloorIds as topoGetColumnSpanFloorIds,
  getColumnLiftHeightFt as topoGetColumnLiftHeightFt,
} from './topology/columns.js'
import { resolveColumnTypeForColumn } from './specs/resolution.js'
import {
  getFoundationForColumn as topoGetFoundationForColumn,
  getFoundationForWall as topoGetFoundationForWall,
  getFoundationsForWall as topoGetFoundationsForWall,
  getColumnsByFoundation as topoGetColumnsByFoundation,
} from './topology/foundations.js'

import { safeR2 as r2 } from './lib/numbers.js'
import { uidIfc } from './lib/ids.js'

// Unit conversion: 1 ft³ = 0.0283168 m³
const FT3_TO_M3 = 0.0283168

// Fix 3: a slab's structural role is derived from its position in the floor stack.
// Top floor → ROOF, intermediate → FLOOR. Sunken/staircase callers override the role.
function inferSlabRole(state, floorId) {
  const floors = state.projectSettings?.floors ?? []
  if (floors.length <= 1) return 'ROOF'
  const sorted = [...floors].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  const idx = sorted.findIndex(f => f.id === floorId)
  return idx === sorted.length - 1 ? 'ROOF' : 'FLOOR'
}

// Phase 4 Tier-2 ADD 1: the auto-derived role for a given slab. SUNKEN type
// is always SUNKEN; otherwise the floor-stack position rule applies. Used by
// addSlab/autoInitSlabs/resetSlabRoleToAuto so the three paths agree by
// construction.
function autoInferRoleForSlab(state, { type, floorId }) {
  return type === 'SUNKEN' ? 'SUNKEN' : inferSlabRole(state, floorId)
}

// Reference-equality memo cells (one per cached selector). Single-store
// assumption — one cell per module is sufficient. See src/topology/cache.js.
const _concreteMemo    = createMemo()
const _masonryDedMemo  = createMemo()
const _foundationMemo  = createMemo()

export const DEFAULT_COLUMN_TYPES = [
  { id: 'C1', label: 'Corner 9×9',    widthIn: 9,  depthIn: 9,  shape: 'rect',   footingLengthFt: 3, footingWidthFt: 3, footingDepthFt: 1    },
  { id: 'C2', label: 'External 9×12', widthIn: 9,  depthIn: 12, shape: 'rect',   footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1    },
  { id: 'C3', label: 'Heavy 12×12',   widthIn: 12, depthIn: 12, shape: 'rect',   footingLengthFt: 5, footingWidthFt: 5, footingDepthFt: 1.25 },
  { id: 'C4', label: 'Circular Φ12',  diamIn: 12,              shape: 'circle', footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1    },
]

export const DEFAULT_FLOOR_ID = 'F1'

export const DEFAULT_FLOORS = [
  { id: DEFAULT_FLOOR_ID, label: 'Floor 1', sequence: 0, plinthHeightFt: 1.5, floorHeightFt: 10, meta: null, underlay: null },
]

export const DEFAULT_PROJECT_SETTINGS = {
  // Area 1 — dimension convention. 'centerline' matches as-drawn geometry
  // (legacy behavior). 'clear_internal' insets each edge by half-wall-
  // thickness so finishes match site-measured interior dimensions.
  // Default 'centerline' is legacy-safe; loadProject opts new projects into
  // 'clear_internal' explicitly (data.projectSettings == null path).
  dimensionMode: 'centerline',
  // Face-aware draw reference. 'inside_face' is the default new-project
  // value (RERA-aligned tracing convention: architect plans label rooms
  // by clear inside dimension). loadProject injects this on every project
  // lacking the field — greenfield, no migration; the setting governs
  // FUTURE draws only.
  drawReference: 'inside_face',

  mortarRatio: '1:6',
  wastagePercent: 5,
  plasterThicknessMm: { internal: 12, ceiling: 10, external: 15 },  // legacy; superseded by defaultPlasterSystemId
  defaultPlasterSystemId:         DEFAULT_PLASTER_SYSTEM_ID,
  defaultExternalPlasterSystemId: 'CEMENT_SAND_EXTERNAL',

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
    tie:    { widthIn: 9,  depthIn: 12 },   // BBS-categories phase — grade/tie band
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

  // Rev 2 — tile defaults (floor tiles + dado + skirting + counter wastage).
  // Dado height keyed by room type; per-room override slot at room.dadoHeightFt.
  tileDefaults: {
    dadoHeightsFt: {
      TOILET:  7,
      KITCHEN: 2,
      UTILITY: 4,
      BALCONY: 0,
      OTHER:   0,
    },
    skirtingHeightIn:     4,
    skirtingApplyToTypes: ['BEDROOM','LIVING','DINING','FOYER','POOJA','STUDY','STORE','PARKING'],
    floorTileAllowance:   1.05,
    wallTileAllowance:    1.10,
  },

  // Rev 2 — kitchen granite counter defaults.
  // Per-room override slot at room.kitchenCounter.
  kitchenCounter: {
    defaultDepthFt:    2.0,
    defaultLengthMode: 'longest_wall',   // | 'half_perimeter' | 'manual'
  },

  // Rev 2 — grills + handrails project defaults.
  // Per-entity overrides at opening.hasGrill, staircase.hasHandrail,
  // room.balconyHandrail, wall.hasBalconyRailingEdge.
  grills: {
    windowGrillEnabled:           true,
    windowGrillExternalOnly:      true,
    mainDoorSafetyGrillEnabled:   false,
    staircaseHandrailEnabled:     true,
    staircaseHandrailHeightFt:    3.0,
    balconyHandrailEnabled:       true,
    balconyHandrailHeightFt:      3.5,
  },

  // Phase 1.7 — reinforcement spec catalog (specId → spec) populated by user
  // via BBSSpecPanel. Empty until user applies presets or creates specs.
  reinforcementSpecs: {},

  // Project-default specIds per element category. When an element's instance
  // spec is unset, resolution.js falls through to these.
  // BEAM is per-class because plinth/lintel/roof rebar typically differs.
  // No global beam fallback — class default unset → ESTIMATE.
  bbsDefaults: {
    COLUMN:  null,
    SLAB:    null,
    FOOTING: null,
    BEAM: {
      tie:    null,   // BBS-categories phase — grade/tie band beam
      plinth: null,
      lintel: null,
      roof:   null,
    },
    // BBS-categories phase (2026-05-29) — new element project-default specs.
    // null = kg/m³ estimate (and, since these elements are opt-in, no BBS
    // groups at all). Keeps every existing verify green by default.
    SUNSHADE:  null,
    LOFT:      null,
    STAIRCASE: null,
    STRAP:     null,
    // Gap 3 — standard bar length (m) for the per-Ø procurement rollup.
    // 6m matches user spec; 12m allowed for crane-handled work.
    standardBarLengthM: STANDARD_BAR_LENGTH_M,
  },

  // BBS allowance convention. IS_STRICT (default) = full IS 2502 (9d hooks,
  // 56.6d lap, dia-based bend deductions, Ld anchorage). SITE_PRACTICE = flat
  // ft allowances + 50d lap matching a contractor's hand BBS. Toggling
  // recomputes all RebarGroups (computed state — no trace change).
  bbsAllowanceMode: 'IS_STRICT',

  // ── Gap 1 — Project metadata (Excel cover + PDF cover) ───────────────────
  projectMeta: {
    projectTitle: '',
    ownerName:    '',
    location:     '',
    preparedBy:   '',
    checkedBy:    '',
    approvedBy:   '',
    preparedDate: null,  // ISO yyyy-mm-dd; null → exporter stamps today
  },

  // ── Gap 2 — Contingency (global default + per-category override) ─────────
  contingency: {
    defaultPercent:     10,
    overrides: {
      steel:             5,
      joinery:           5,
      joinery_hardware:  5,
      plumbing_supply:   5,
      plumbing_drainage: 5,
      plumbing_fixtures: 5,
      electrical_lighting: 5,
      electrical_power:    5,
      electrical_hvac:     5,
    },
    excludedCategories: ['staircase'],
    displayMode:        'clean',  // 'detailed' | 'clean' — Addition 2
  },

  // ── Gap 6 — Paint system defaults ────────────────────────────────────────
  defaultInteriorPaintSystemId: DEFAULT_INTERIOR_PAINT_SYSTEM_ID,
  defaultExteriorPaintSystemId: DEFAULT_EXTERIOR_PAINT_SYSTEM_ID,

  // ── Gap 7 — Ceiling finish default ───────────────────────────────────────
  defaultCeilingFinishSystemId: DEFAULT_CEILING_FINISH_SYSTEM_ID,

  // ── Gap 4 + 5 — Door / window hardware defaults per subtype ──────────────
  doorHardwareDefaults:   { ...DEFAULT_DOOR_HARDWARE_DEFAULTS   },
  windowHardwareDefaults: { ...DEFAULT_WINDOW_HARDWARE_DEFAULTS },

  // ── Gap 8 — Project costs (labor / supervision / GST) ────────────────────
  projectCosts: { ...DEFAULT_PROJECT_COSTS },

  // Area 2D — Smart MEP defaults. When true (default), creating a new room
  // auto-applies suggestPlumbing/Electrical/Hvac/Fire/Elv for the room type.
  // When false, the MepDefaultsModal opens for manual selection (legacy flow).
  autoMepDefaultsEnabled: true,

  // ── Snap architecture (Phase A) ──────────────────────────────────────────
  // Unified snap config. Defaults reproduce today's behavior byte-identically:
  // pitchIn=12 (legacy GRID_IN), NODE+WALL_ENDPOINT+GRID on, WALL_NEAREST on
  // (replicates MEP today), WALL_SEGMENT on (replicates Split today),
  // WALL_MIDPOINT off (opt-in). bypassKey='Alt' is AutoCAD convention.
  snap: {
    enabled:       true,
    pitchIn:       12,
    pitchPresets:  [1, 3, 6, 12, 24],
    bypassKey:     'Alt',                          // 'Alt' | 'Shift' | 'Ctrl' | 'None'
    targets:       buildDefaultTargetSettings(),   // pulled from SNAP_TARGETS registry
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
  // Phase 1.7+ — per-instance BBS spec UX: explicit beam selection.
  // Wall-derived beams are not selectable (no persistent entity to bind to).
  selectedBeamId: null,

  // ── projectSettings actions ────────────────────────────────────────────────

  setProjectSettings: (partial) => set(state => ({
    projectSettings: { ...state.projectSettings, ...partial },
  })),

  // ── Snap settings (Phase A) ─────────────────────────────────────────────
  // Deep-merges `partial` into projectSettings.snap. `targets` is a special
  // case: nested-merge per target id (so toggling NODE.enabled doesn't
  // wipe NODE.toleranceIn or sibling targets).
  setSnapSettings: (partial) => set(state => {
    const prev = state.projectSettings.snap ?? DEFAULT_PROJECT_SETTINGS.snap
    let nextTargets = prev.targets
    if (partial && partial.targets) {
      nextTargets = { ...(prev.targets ?? {}) }
      for (const [id, cfg] of Object.entries(partial.targets)) {
        nextTargets[id] = { ...(prev.targets?.[id] ?? {}), ...(cfg ?? {}) }
      }
    }
    return {
      projectSettings: {
        ...state.projectSettings,
        snap: { ...prev, ...(partial ?? {}), targets: nextTargets },
      },
    }
  }),
  toggleSnapEnabled: () => set(state => {
    const prev = state.projectSettings.snap ?? DEFAULT_PROJECT_SETTINGS.snap
    return {
      projectSettings: {
        ...state.projectSettings,
        snap: { ...prev, enabled: !prev.enabled },
      },
    }
  }),

  // Area 1 — dimension convention. Stamps projectSettings.dimensionMode.
  // Validates against the two allowed values; ignores anything else.
  setDimensionMode: (mode) => set(state => {
    if (mode !== 'centerline' && mode !== 'clear_internal') return {}
    return {
      projectSettings: { ...state.projectSettings, dimensionMode: mode },
    }
  }),

  // Face-aware draw reference (2026-05-28). Governs how the user's
  // clicks are interpreted when authoring NEW walls / rectangle rooms:
  //   'inside_face'  — clicks are inside-face corners (RERA-default
  //                    convention; tracing tool default for room labels).
  //   'centerline'   — clicks are wall centerlines (legacy behavior).
  //   'outside_face' — clicks are outside-face corners (plot perimeter).
  // The setting only affects FUTURE draws — existing centerline storage
  // is canonical and unchanged. See src/draw/faceToCenterline.js for
  // the conversion + closure-in-face-space ordering rule.
  setDrawReference: (mode) => set(state => {
    if (mode !== 'inside_face' && mode !== 'centerline' && mode !== 'outside_face') return {}
    return {
      projectSettings: { ...state.projectSettings, drawReference: mode },
    }
  }),

  // ── Underlay actions — per-floor (Fix 3) ─────────────────────────────────
  // Underlay records live on each floor: projectSettings.floors[i].underlay.
  // Each floor owns its own asset blob (key = `${projectId}::underlay::${floorId}`)
  // so switching floors changes which plan is displayed under the canvas.
  // Every setter takes an optional floorId — when omitted, defaults to
  // state.currentFloorId so unscoped UI calls just affect the visible floor.
  //
  // Reads: consumers fetch via `state.projectSettings.floors.find(f => f.id === floorId).underlay`
  // (helper `getFloorUnderlay(state, floorId)` exposed below).
  setUnderlay: (partial, floorId) => set(state => {
    const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
    const floors = (state.projectSettings.floors ?? DEFAULT_FLOORS).map(f =>
      f.id === fid
        ? { ...f, underlay: { ...(f.underlay ?? {}), ...partial } }
        : f
    )
    return { projectSettings: { ...state.projectSettings, floors } }
  }),
  clearUnderlay: (floorId) => set(state => {
    const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
    const floors = (state.projectSettings.floors ?? DEFAULT_FLOORS).map(f =>
      f.id === fid ? { ...f, underlay: null } : f
    )
    return { projectSettings: { ...state.projectSettings, floors } }
  }),
  setUnderlayCalibration: (calibration, floorId) => set(state => {
    const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
    const floors = (state.projectSettings.floors ?? DEFAULT_FLOORS).map(f => {
      if (f.id !== fid || !f.underlay) return f
      return { ...f, underlay: { ...f.underlay, calibration } }
    })
    return { projectSettings: { ...state.projectSettings, floors } }
  }),
  setUnderlayPlacement: (placement, floorId) => set(state => {
    const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
    const floors = (state.projectSettings.floors ?? DEFAULT_FLOORS).map(f => {
      if (f.id !== fid || !f.underlay) return f
      return { ...f, underlay: { ...f.underlay, placement: { ...(f.underlay.placement ?? {}), ...placement } } }
    })
    return { projectSettings: { ...state.projectSettings, floors } }
  }),
  setUnderlayOpacity: (opacity, floorId) => set(state => {
    const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
    const v = Math.max(0.05, Math.min(1, opacity))
    const floors = (state.projectSettings.floors ?? DEFAULT_FLOORS).map(f => {
      if (f.id !== fid || !f.underlay) return f
      return { ...f, underlay: { ...f.underlay, opacity: v } }
    })
    return { projectSettings: { ...state.projectSettings, floors } }
  }),
  setUnderlayVisible: (visible, floorId) => set(state => {
    const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
    const floors = (state.projectSettings.floors ?? DEFAULT_FLOORS).map(f => {
      if (f.id !== fid || !f.underlay) return f
      return { ...f, underlay: { ...f.underlay, visible: !!visible } }
    })
    return { projectSettings: { ...state.projectSettings, floors } }
  }),

  // Pure read helper — used by UnderlayLayer / CalibrationModal / Canvas /
  // LayersPanel so every consumer goes through one accessor. Returns null
  // when the floor has no underlay.
  getFloorUnderlay(floorId) {
    const state = get()
    const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
    const floors = state.projectSettings?.floors ?? DEFAULT_FLOORS
    return floors.find(f => f.id === fid)?.underlay ?? null
  },

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
            { id, label: `Floor ${sequence + 1}`, sequence, plinthHeightFt: 0, floorHeightFt: 10, meta: null, underlay: null, ...fields },
          ],
        },
      }
    })
    return id
  },

  // Removing a floor also drops the rooms that sit ON it, so the canonical never
  // holds a room on a deleted floor and the sync diff emits the child DELETE_ROOMs
  // BEFORE the floor's own DELETE_FLOOR (FK: room.floorId → floor). Rooms are
  // removed exactly like deleteRoom does (map delete only — that path does not
  // cascade walls/nodes, so neither does this; see report note).
  removeFloor: (id) => set(state => {
    // Cascade the deleted floor's geometry out of canonical so it never holds
    // rooms/walls/nodes on a non-existent floor — keeping canonical consistent with
    // the backend deleteFloor cascade (the diff then emits child DELETE_* ops, which
    // drain before DELETE_FLOOR).
    const rooms = { ...state.rooms }
    for (const rid of Object.keys(rooms)) {
      if ((rooms[rid].floorId ?? DEFAULT_FLOOR_ID) === id) delete rooms[rid]
    }
    const walls = { ...state.walls }
    for (const wid of Object.keys(walls)) {
      if ((walls[wid].floorId ?? DEFAULT_FLOOR_ID) === id) delete walls[wid]
    }
    const nodes = { ...state.nodes }
    for (const nid of Object.keys(nodes)) {
      const fids = nodes[nid].floorIds ?? [DEFAULT_FLOOR_ID]
      if (fids.length && fids.every(f => f === id)) delete nodes[nid] // only on this floor
    }
    return {
      rooms,
      walls,
      nodes,
      projectSettings: {
        ...state.projectSettings,
        floors: (state.projectSettings.floors ?? DEFAULT_FLOORS).filter(f => f.id !== id),
      },
    }
  }),

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

  // Rev 2 — tile / counter / grills project-settings setters.

  setTileDefaults: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      tileDefaults: {
        ...state.projectSettings.tileDefaults,
        ...partial,
        // Deep merge dadoHeightsFt if partial supplied — otherwise the
        // shallow spread above replaces the whole map.
        ...(partial?.dadoHeightsFt ? {
          dadoHeightsFt: { ...state.projectSettings.tileDefaults.dadoHeightsFt, ...partial.dadoHeightsFt },
        } : {}),
      },
    },
  })),

  setKitchenCounter: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      kitchenCounter: { ...state.projectSettings.kitchenCounter, ...partial },
    },
  })),

  setGrills: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      grills: { ...state.projectSettings.grills, ...partial },
    },
  })),

  // ── 2026-05-26 — BOQ extension setters (Gaps 1, 2, 4, 5, 6, 7, 8) ────────

  // Gap 1 — Project metadata (header + signatures)
  setProjectMeta: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      projectMeta: { ...(state.projectSettings.projectMeta ?? {}), ...partial },
    },
  })),

  // Gap 2 — Contingency (default % + per-category overrides + displayMode)
  setContingency: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      contingency: {
        ...(state.projectSettings.contingency ?? {}),
        ...partial,
        ...(partial?.overrides ? {
          overrides: { ...(state.projectSettings.contingency?.overrides ?? {}), ...partial.overrides },
        } : {}),
      },
    },
  })),

  // Gap 6 — Paint system defaults (interior + exterior)
  setDefaultPaintSystems: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      ...(partial?.interior !== undefined ? { defaultInteriorPaintSystemId: partial.interior } : {}),
      ...(partial?.exterior !== undefined ? { defaultExteriorPaintSystemId: partial.exterior } : {}),
    },
  })),

  // Gap 7 — Ceiling finish default
  setDefaultCeilingFinishSystem: (id) => set(state => ({
    projectSettings: { ...state.projectSettings, defaultCeilingFinishSystemId: id },
  })),

  // Gap 4 + 5 — Hardware defaults per subtype
  setDoorHardwareDefaults: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      doorHardwareDefaults: { ...(state.projectSettings.doorHardwareDefaults ?? {}), ...partial },
    },
  })),

  setWindowHardwareDefaults: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      windowHardwareDefaults: { ...(state.projectSettings.windowHardwareDefaults ?? {}), ...partial },
    },
  })),

  // Gap 8 — Project costs (labor / supervision / GST / etc.)
  setProjectCosts: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      projectCosts: { ...(state.projectSettings.projectCosts ?? {}), ...partial },
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
          id,
          ifcGlobalId: uidIfc(),
          x, y, columnTypeId, attachedNodeId,
          baseFloorId: floorId, topFloorId: floorId,
          classification: null,
          reinforcementSpecId: null,
          segments: null,
          meta: null,
          labelNo: null,
        },
      },
    }))
    get().assignElementLabels?.()
    return id
  },

  deleteColumn: (id) => {
    get()._save()
    set(state => {
      const nextColumns = { ...state.columns }
      delete nextColumns[id]
      // Detach (don't delete) beams that reference this column — preserve the
      // beam geometry + record provenance (Correction 1). The endpoint freezes
      // at its last-resolved position as a POINT carrying detachedFrom; the
      // beam_no_support rule then flags it, and undo restores the connection.
      const nextBeams = {}
      const events = []
      for (const [bid, beam] of Object.entries(state.beams)) {
        let nb = beam
        for (const which of ['from', 'to']) {
          const ep = beam.endpoints[which]
          if (ep.type === 'COLUMN' && ep.columnId === id) {
            const pos = topoResolveBeamEndpoint(state, ep) ?? { x: 0, y: 0 }
            nb = { ...nb, endpoints: { ...nb.endpoints, [which]: { type: 'POINT', x: pos.x, y: pos.y, detachedFrom: { type: 'COLUMN', columnId: id } } } }
            events.push({ ruleId: 'beam_endpoint_detached', severity: 'warning', category: 'structural', entityType: 'beam', entityId: bid, message: `beam ${bid} ${which} endpoint detached — column ${id} deleted`, meta: { which, detachedFrom: { type: 'COLUMN', columnId: id } } })
          }
        }
        nextBeams[bid] = nb
      }
      // Fix 1: foundation owns columnIds[]. Removing a column scrubs it from every foundation.
      const nextFoundations = {}
      for (const [fid, f] of Object.entries(state.foundations)) {
        const cids = (f.columnIds || []).filter(cid => cid !== id)
        nextFoundations[fid] = cids.length === (f.columnIds || []).length ? f : { ...f, columnIds: cids }
      }
      return {
        columns: nextColumns, beams: nextBeams, foundations: nextFoundations,
        ...(events.length ? { validationEvents: [...(state.validationEvents ?? []), ...events].slice(-100) } : {}),
      }
    })
  },

  setColumnFloorSpan: (id, baseFloorId, topFloorId) => {
    get()._save()
    set(state => ({
      columns: { ...state.columns, [id]: { ...state.columns[id], baseFloorId, topFloorId } },
    }))
  },

  // Phase ColumnStack — extend an existing column stack to include floorId.
  // Raises topFloorId (and lowers baseFloorId if floorId is below the base)
  // in floor-sequence order. NEVER creates a new entity — a column is one
  // continuous vertical member. Returns the (unchanged) column id.
  extendColumnToFloor: (id, floorId) => {
    const sorted = [...(get().projectSettings?.floors ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    const col = get().columns[id]
    if (!col || sorted.length === 0) return id
    const idxOf = fid => sorted.findIndex(f => f.id === fid)
    const baseIdx = idxOf(col.baseFloorId ?? sorted[0].id)
    const topIdx  = idxOf(col.topFloorId  ?? col.baseFloorId ?? sorted[0].id)
    const tgtIdx  = idxOf(floorId)
    if (tgtIdx === -1) return id
    const nextBaseIdx = Math.min(baseIdx, tgtIdx)
    const nextTopIdx  = Math.max(topIdx,  tgtIdx)
    get()._save()
    set(state => ({
      columns: { ...state.columns, [id]: {
        ...state.columns[id],
        baseFloorId: sorted[nextBaseIdx].id,
        topFloorId:  sorted[nextTopIdx].id,
      } },
    }))
    return id
  },

  // Phase ColumnStack — lower the column's top to floorId (delete the lifts
  // above). If floorId is below the base, the whole column is deleted (no
  // lifts remain). Prunes orphaned segment overrides outside the new span.
  truncateColumnToFloor: (id, floorId) => {
    const sorted = [...(get().projectSettings?.floors ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    const col = get().columns[id]
    if (!col || sorted.length === 0) return
    const idxOf = fid => sorted.findIndex(f => f.id === fid)
    const baseIdx = idxOf(col.baseFloorId ?? sorted[0].id)
    const tgtIdx  = idxOf(floorId)
    if (tgtIdx === -1) return
    if (tgtIdx < baseIdx) { get().deleteColumn(id); return }
    const keep = new Set(sorted.slice(Math.min(baseIdx, tgtIdx), Math.max(baseIdx, tgtIdx) + 1).map(f => f.id))
    get()._save()
    set(state => {
      const prevSeg = state.columns[id].segments
      let nextSeg = prevSeg
      if (prevSeg) {
        nextSeg = {}
        for (const [fid, v] of Object.entries(prevSeg)) if (keep.has(fid)) nextSeg[fid] = v
        if (Object.keys(nextSeg).length === 0) nextSeg = null
      }
      return {
        columns: { ...state.columns, [id]: {
          ...state.columns[id], topFloorId: floorId, segments: nextSeg,
        } },
      }
    })
  },

  // Phase ColumnStack — write a per-floor segment override (section and/or
  // reinforcement) on a column. Immutable nested update (Zustand v5 shallow
  // merge → explicit spread). Empty partials are ignored.
  setColumnSegment: (id, floorId, partial) => {
    if (!floorId || !partial || Object.keys(partial).length === 0) return
    get()._save()
    set(state => {
      const col = state.columns[id]
      if (!col) return {}
      const segments = { ...(col.segments ?? {}) }
      segments[floorId] = { ...(segments[floorId] ?? {}), ...partial }
      return { columns: { ...state.columns, [id]: { ...col, segments } } }
    })
  },

  // Phase ColumnStack — clear a column's segment override for one floor.
  // Drops the segments map entirely when no overrides remain.
  clearColumnSegment: (id, floorId) => {
    get()._save()
    set(state => {
      const col = state.columns[id]
      if (!col || !col.segments || !(floorId in col.segments)) return {}
      const segments = { ...col.segments }
      delete segments[floorId]
      return { columns: { ...state.columns, [id]: {
        ...col, segments: Object.keys(segments).length === 0 ? null : segments,
      } } }
    })
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
          ifcGlobalId: uidIfc(),
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
          ifcGlobalId: uidIfc(),
          endpoints: {
            from: { type: 'COLUMN', columnId: fromColumnId },
            to:   { type: 'COLUMN', columnId: toColumnId },
          },
          level,
          source: 'EXPLICIT',
          floorId,
          meta: null,
          labelNo: null,
        },
      },
    }))
    get().assignElementLabels?.()
    return id
  },

  // Generalized create — accepts arbitrary endpoint descriptors
  // ({type:'COLUMN'|'BEAM'|'WALL'|'POINT', ...}). Caller pre-resolves the
  // descriptor (e.g. Canvas projects a click onto a target to get parametric t).
  // Mirrors addBeam's history-frame + id-generation pattern.
  addBeamWithEndpoints: (fromRef, toRef, level, opts = {}) => {
    const id = uid()
    const state = get()
    const refFloor = (ref) => {
      if (!ref) return null
      if (ref.type === 'COLUMN') return state.columns?.[ref.columnId]?.floorId ?? null
      if (ref.type === 'BEAM')   return state.beams?.[ref.beamId]?.floorId ?? null
      if (ref.type === 'WALL')   return state.walls?.[ref.wallId]?.floorId ?? null
      return null
    }
    const floorId = opts.floorId ?? refFloor(fromRef) ?? refFloor(toRef)
      ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
    state._save()
    set(s => ({
      beams: {
        ...s.beams,
        [id]: {
          id,
          ifcGlobalId: uidIfc(),
          endpoints: { from: fromRef, to: toRef },
          level,
          source: 'EXPLICIT',
          floorId,
          meta: null,
          labelNo: null,
        },
      },
    }))
    get().assignElementLabels?.()
    return id
  },

  // Delete a beam. Beams that frame INTO this beam (BEAM endpoint) are NOT
  // deleted — their endpoint detaches to a frozen POINT carrying detachedFrom
  // provenance (geometry survives; validation explains; undo restores).
  deleteBeam: (id) => {
    get()._save()
    set(state => {
      const next = { ...state.beams }
      delete next[id]
      const events = []
      for (const [bid, beam] of Object.entries(next)) {
        let nb = beam
        for (const which of ['from', 'to']) {
          const ep = beam.endpoints?.[which]
          if (ep?.type === 'BEAM' && ep.beamId === id) {
            const pos = topoResolveBeamEndpoint(state, ep) ?? { x: 0, y: 0 }
            nb = { ...nb, endpoints: { ...nb.endpoints, [which]: { type: 'POINT', x: pos.x, y: pos.y, detachedFrom: { type: 'BEAM', beamId: id } } } }
            events.push({ ruleId: 'beam_endpoint_detached', severity: 'warning', category: 'structural', entityType: 'beam', entityId: bid, message: `beam ${bid} ${which} endpoint detached — beam ${id} deleted`, meta: { which, detachedFrom: { type: 'BEAM', beamId: id } } })
          }
        }
        if (nb !== beam) next[bid] = nb
      }
      const cleared = state.selectedBeamId === id ? { selectedBeamId: null } : {}
      return { beams: next, ...cleared, ...(events.length ? { validationEvents: [...(state.validationEvents ?? []), ...events].slice(-100) } : {}) }
    })
  },

  selectBeam: (id) => set({
    selectedBeamId: id,
    selectedWallId: null, selectedWallIds: [], selectedStampId: null,
    selectedRoomId: null, selectedColumnId: null, selectedFoundationId: null,
  }),

  // Per-instance BBS — explicit beams only. Wall-derived beams have no entity.
  setBeamReinforcementSpec: (beamId, reinforcementSpecId) => {
    get()._save()
    set(state => {
      const beam = state.beams[beamId]
      if (!beam) return {}
      return { beams: { ...state.beams, [beamId]: { ...beam, reinforcementSpecId } } }
    })
  },

  setFoundationReinforcementSpec: (foundationId, reinforcementSpecId) => {
    get()._save()
    set(state => {
      const f = state.foundations[foundationId]
      if (!f) return {}
      return { foundations: { ...state.foundations, [foundationId]: { ...f, reinforcementSpecId } } }
    })
  },

  // "Apply to matching elements" — propagate one entity's spec to all
  // geometrically-matching peers (same type/dimensions/class).
  //
  // Match rules (geometry-only, never floor-based):
  //   COLUMN     — same columnTypeId
  //   BEAM       — same beamClass (explicit beams only; wall-derived beams
  //                 resolve via class default and don't take instance specs)
  //   SLAB       — same role/classification (FLOOR / ROOF / SUNKEN / STAIR_LANDING)
  //   FOUNDATION — same type (ISOLATED / COMBINED / RAFT / STRIP / PILE)
  //
  // Returns the affected entity ids array so the UI can show a confirm count.
  // (No confirm dialog inside the store — caller decides UX.)
  applyReinforcementSpecToMatching: ({ elementType, sourceEntityId, specId }) => {
    const state = get()
    let affected = []
    if (elementType === 'COLUMN') {
      const src = state.columns[sourceEntityId]
      if (!src) return []
      affected = Object.values(state.columns)
        .filter(c => c.id !== sourceEntityId && c.columnTypeId === src.columnTypeId)
        .map(c => c.id)
      if (affected.length === 0) return []
      get()._save()
      set(s => {
        const next = { ...s.columns }
        for (const id of affected) next[id] = { ...next[id], reinforcementSpecId: specId }
        return { columns: next }
      })
    } else if (elementType === 'BEAM') {
      const src = state.beams[sourceEntityId]
      if (!src) return []
      const srcClass = src.beamClass ?? src.level
      affected = Object.values(state.beams)
        .filter(b => b.id !== sourceEntityId && (b.beamClass ?? b.level) === srcClass)
        .map(b => b.id)
      if (affected.length === 0) return []
      get()._save()
      set(s => {
        const next = { ...s.beams }
        for (const id of affected) next[id] = { ...next[id], reinforcementSpecId: specId }
        return { beams: next }
      })
    } else if (elementType === 'SLAB') {
      const src = state.slabs[sourceEntityId]
      if (!src) return []
      const srcRole = src.role ?? src.classification ?? null
      affected = Object.values(state.slabs)
        .filter(sl => sl.id !== sourceEntityId && (sl.role ?? sl.classification ?? null) === srcRole)
        .map(sl => sl.id)
      if (affected.length === 0) return []
      get()._save()
      set(s => {
        const next = { ...s.slabs }
        for (const id of affected) next[id] = { ...next[id], reinforcementSpecId: specId }
        return { slabs: next }
      })
    } else if (elementType === 'FOUNDATION') {
      const src = state.foundations[sourceEntityId]
      if (!src) return []
      affected = Object.values(state.foundations)
        .filter(f => f.id !== sourceEntityId && f.type === src.type)
        .map(f => f.id)
      if (affected.length === 0) return []
      get()._save()
      set(s => {
        const next = { ...s.foundations }
        for (const id of affected) next[id] = { ...next[id], reinforcementSpecId: specId }
        return { foundations: next }
      })
    }
    return affected
  },

  // ── Slab actions ───────────────────────────────────────────────────────────

  // Fix 3: slab.classification + slab.role (alias) populated on creation.
  // 'SUNKEN' → toilet/balcony, 'ROOF' → top floor, 'FLOOR' → intermediate, 'STAIR_LANDING' → custom.
  addSlab: (type, roomIds, thicknessIn, sinkDepthIn = 0, options = {}) => {
    const id = uid()
    const floorId = options.floorId ?? get().currentFloorId ?? DEFAULT_FLOOR_ID
    // ADD 1: `options.role` is treated as an explicit override → MANUAL.
    // Otherwise the auto-inference rule runs → AUTO.
    const explicitRole = options.role
    const role         = explicitRole ?? autoInferRoleForSlab(get(), { type, floorId })
    const roleSource   = explicitRole ? 'MANUAL' : 'AUTO'
    get()._save()
    set(state => ({
      slabs: {
        ...state.slabs,
        [id]: {
          id,
          ifcGlobalId: uidIfc(),
          type, roomIds: [...roomIds], thicknessIn, sinkDepthIn, grade: 'M20',
          floorId,
          classification: role,
          role,
          roleSource,
          reinforcementSpecId: null,
          meta: null,
          labelNo: null,
        },
      },
    }))
    get().assignElementLabels?.()
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
        id: mainId,
        ifcGlobalId: uidIfc(),
        type: 'MAIN', roomIds: mainRoomIds,
        thicknessIn: mainThicknessIn, sinkDepthIn: 0, grade: 'M20',
        floorId, classification: mainRole, role: mainRole,
        roleSource: 'AUTO',
        reinforcementSpecId: null, meta: null, labelNo: null,
      }
    }

    for (const roomId of sunkenRoomIds) {
      const sunkenId = uid()
      newSlabs[sunkenId] = {
        id: sunkenId,
        ifcGlobalId: uidIfc(),
        type: 'SUNKEN', roomIds: [roomId],
        thicknessIn: mainThicknessIn, sinkDepthIn: sunkenDepthIn, grade: 'M20',
        floorId, classification: 'SUNKEN', role: 'SUNKEN',
        roleSource: 'AUTO',
        reinforcementSpecId: null, meta: null, labelNo: null,
      }
    }

    set({ slabs: newSlabs })
    get().assignElementLabels?.()
  },

  setSlabRole: (slabId, role) => {
    // ADD 1: roleSource flips to MANUAL only when role actually changes.
    // A no-op call (same role) leaves provenance untouched so a "set to
    // current value" UI gesture never silently flips an AUTO-inferred slab.
    const current = get().slabs[slabId]
    if (!current) return
    if (current.role === role && current.classification === role) return
    get()._save()
    set(state => {
      const slab = state.slabs[slabId]
      if (!slab) return {}
      return {
        slabs: {
          ...state.slabs,
          [slabId]: { ...slab, role, classification: role, roleSource: 'MANUAL' },
        },
      }
    })
  },

  // ADD 1: re-run inference and stamp roleSource='AUTO'. Used by the
  // SlabPanel "Reset to auto" button.
  resetSlabRoleToAuto: (slabId) => {
    const state = get()
    const slab = state.slabs[slabId]
    if (!slab) return
    const inferred = autoInferRoleForSlab(state, { type: slab.type, floorId: slab.floorId })
    if (slab.role === inferred && slab.classification === inferred && slab.roleSource === 'AUTO') return
    get()._save()
    set(s => ({
      slabs: {
        ...s.slabs,
        [slabId]: { ...s.slabs[slabId], role: inferred, classification: inferred, roleSource: 'AUTO' },
      },
    }))
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

  // Rev 2 — per-staircase handrail override. null = inherit project setting
  // (projectSettings.grills.staircaseHandrailEnabled).
  setStaircaseHandrail: (id, hasHandrail) => {
    get()._save()
    set(state => {
      const sc = state.staircases[id]
      if (!sc) return {}
      return { staircases: { ...state.staircases, [id]: { ...sc, hasHandrail } } }
    })
  },

  // ── Wall / opening actions ─────────────────────────────────────────────────

  setWallBeamFlags: (wallId, flags) => {
    get()._save()
    set(state => ({
      walls: { ...state.walls, [wallId]: { ...state.walls[wallId], ...flags } },
    }))
  },

  // BBS-4 — per-wall, per-beam-class reinforcement spec override. Wall-derived
  // beams (the majority in residential projects) have no entity to attach a
  // spec to; this slot is consulted by resolveBeamReinforcementSpec's
  // WALL_INSTANCE tier before falling back to bbsDefaults.BEAM[class] or
  // ESTIMATE. Passing specId === null clears the override for that class.
  setWallBeamSpec: (wallId, beamClass, specId) => {
    get()._save()
    set(state => {
      const wall = state.walls[wallId]
      if (!wall) return {}
      const current = wall.wallBeamSpecs ?? {}
      const next = { ...current }
      if (specId) next[beamClass] = specId
      else delete next[beamClass]
      const hasAny = Object.keys(next).length > 0
      return {
        walls: {
          ...state.walls,
          [wallId]: { ...wall, wallBeamSpecs: hasAny ? next : null },
        },
      }
    })
  },

  // ── BBS-categories phase setters (2026-05-29) ───────────────────────────────
  // Sub/super column segment override. null = auto-derive (when split enabled).
  setColumnPosition: (columnId, position) => {
    get()._save()
    set(state => {
      const col = state.columns[columnId]
      if (!col) return {}
      return { columns: { ...state.columns, [columnId]: { ...col, position: position ?? null } } }
    })
  },

  // Tie/grade band beam opt-in for a wall (BBS-only). true/false/null.
  setWallTieBeam: (wallId, hasTieBeam) => {
    get()._save()
    set(state => {
      const wall = state.walls[wallId]
      if (!wall) return {}
      return { walls: { ...state.walls, [wallId]: { ...wall, hasTieBeam } } }
    })
  },

  // Loft attribute on a wall. partial merges into { enabled, widthFt, depthFt,
  // heightFt }; pass null to clear the loft entirely.
  setWallLoft: (wallId, partial) => {
    get()._save()
    set(state => {
      const wall = state.walls[wallId]
      if (!wall) return {}
      const next = partial === null ? null : { ...(wall.loft ?? {}), ...partial }
      return { walls: { ...state.walls, [wallId]: { ...wall, loft: next } } }
    })
  },

  setWallLoftSpec: (wallId, specId) => {
    get()._save()
    set(state => {
      const wall = state.walls[wallId]
      if (!wall) return {}
      return { walls: { ...state.walls, [wallId]: { ...wall, loftSpecId: specId ?? null } } }
    })
  },

  // Per-opening sunshade reinforcement spec override.
  setOpeningSunshadeSpec: (wallId, openingId, specId) => {
    get()._save()
    set(state => {
      const wall = state.walls[wallId]
      if (!wall) return {}
      return {
        walls: {
          ...state.walls,
          [wallId]: {
            ...wall,
            openings: wall.openings.map(o =>
              o.id === openingId ? { ...o, sunshadeSpecId: specId ?? null } : o),
          },
        },
      }
    })
  },

  // Staircase instance reinforcement spec override.
  setStaircaseReinforcementSpec: (staircaseId, specId) => {
    get()._save()
    set(state => {
      const s = state.staircases[staircaseId]
      if (!s) return {}
      return { staircases: { ...state.staircases, [staircaseId]: { ...s, reinforcementSpecId: specId ?? null } } }
    })
  },

  // BBS allowance mode switch (IS_STRICT | SITE_PRACTICE). Single toggle;
  // re-derives every RebarGroup on next computeRebarGroups call.
  setBbsAllowanceMode: (mode) => {
    const m = mode === 'SITE_PRACTICE' ? 'SITE_PRACTICE' : 'IS_STRICT'
    get()._save()
    set(state => ({ projectSettings: { ...state.projectSettings, bbsAllowanceMode: m } }))
  },

  // Rev 2 future-ready slot — programmatic override of the balcony-railing-edge
  // heuristic. Null = inherit heuristic (external + bounds a BALCONY room, no
  // large door). true/false = explicit. No UI in current iteration; provided
  // for DXF importers / clone tools / power users via DevTools.
  setWallBalconyRailingEdge: (wallId, hasBalconyRailingEdge) => {
    get()._save()
    set(state => {
      const wall = state.walls[wallId]
      if (!wall) return {}
      return { walls: { ...state.walls, [wallId]: { ...wall, hasBalconyRailingEdge } } }
    })
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
  getWallAdjacencyCount: ()       => topoGetWallAdjacencyCount(get()),
  classifyWallBeamFlags: (wallId) => topoClassifyWallBeamFlags(get(), wallId),

  // Wall-derived beams + merged-beams view delegate to topology.
  getDerivedWallBeams: () => topoGetDerivedWallBeams(get()),
  getAllBeams:         () => topoGetAllBeams(get()),

  getColumnHeightFt: (column) => topoGetColumnHeightFt(get(), column),

  // Returns { [columnTypeId]: { count, columnHeightFt, sectionFt2, volFt3, label } }
  // Phase ColumnStack — per-floor accounting:
  //   • count   = column ENTITY count, attributed to each column's DEFAULT
  //               section (foundations/labels rely on one entity = one footing).
  //   • volFt3  = Σ over the column's span of (resolved-per-floor section area ×
  //               that floor's lift height) — so per-floor section overrides and
  //               multi-floor spans are accounted correctly (no double-count).
  // A single-floor column reduces to one lift at its default section → output is
  // byte-identical to the pre-phase whole-column form.
  getColumnQuantities: () => {
    const state = get()
    const { columns, projectSettings } = state
    const { columnTypes } = projectSettings
    const result = {}
    const ensure = (ct, repHeightFt) => {
      if (!result[ct.id]) {
        result[ct.id] = { count: 0, columnHeightFt: repHeightFt, sectionFt2: getColumnAreaFt2(ct), volFt3: 0, label: ct.label }
      }
      return result[ct.id]
    }
    for (const col of Object.values(columns)) {
      const fullHeightFt = topoGetColumnHeightFt(state, col)
      const defaultCt = columnTypes.find(t => t.id === col.columnTypeId)
      if (defaultCt) ensure(defaultCt, fullHeightFt).count += 1
      for (const fid of topoGetColumnSpanFloorIds(state, col)) {
        const ct = resolveColumnTypeForColumn(state, col, columnTypes, fid)
        if (!ct) continue
        ensure(ct, fullHeightFt).volFt3 += getColumnAreaFt2(ct) * topoGetColumnLiftHeightFt(state, col, fid)
      }
    }
    for (const k of Object.keys(result)) result[k].volFt3 = r2(result[k].volFt3)
    return result
  },

  // ── Selector discipline (mandatory per task brief) ────────────────────────
  // Centralized relationship/floor selectors. All components and quantity
  // functions go through these — never traverse foundations/columns/walls inline.

  getFoundationForColumn: (columnId)      => topoGetFoundationForColumn(get(), columnId),
  getFoundationForWall:   (wallId)        => topoGetFoundationForWall(get(), wallId),
  getFoundationsForWall:  (wallId)        => topoGetFoundationsForWall(get(), wallId),
  getColumnsByFoundation: (foundationId)  => topoGetColumnsByFoundation(get(), foundationId),

  getColumnsOnFloor:    (floorId) => topoGetColumnsOnFloor(get(), floorId),
  getWallsOnFloor:      (floorId) => topoGetWallsOnFloor(get(), floorId),
  getSlabsOnFloor:      (floorId) => topoGetSlabsOnFloor(get(), floorId),
  getRoomsOnFloor:      (floorId) => topoGetRoomsOnFloor(get(), floorId),
  getStampsOnFloor:     (floorId) => topoGetStampsOnFloor(get(), floorId),
  getBeamsOnFloor:      (floorId) => topoGetBeamsOnFloor(get(), floorId),
  getStaircasesOnFloor: (floorId) => topoGetStaircasesOnFloor(get(), floorId),
  getNodeIdsByFloor:    (floorId) => topoGetNodeIdsOnFloor(get(), floorId),
  getWallIdsByFloor:    (floorId) => topoGetWallIdsOnFloor(get(), floorId),
  getEntitiesOnFloor:   (floorId) => topoGetEntitiesOnFloor(get(), floorId),

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

    return _foundationMemo([columns, foundations, projectSettings, colQ], () => {
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

    return { byFoundation, byColumnTypeInline }
    })
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
    const state = get()
    const { beamDimensions } = state.projectSettings
    const allBeams = state.getAllBeams()

    const result = Object.fromEntries(BEAM_LEVEL_REGISTRY.map(lvl => [lvl.id, null]))
    for (const beam of allBeams) {
      const dims = beamDimensions[beam.level]
      if (!dims) continue
      const from = topoResolveBeamEndpoint(state, beam.endpoints.from)
      const to   = topoResolveBeamEndpoint(state, beam.endpoints.to)
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

  // Returns { footing, column, beam, slab, staircase, civilStamp, total } — all in kg.
  //
  // opts (Phase 1.7+ partial-coverage support):
  //   excludeColumnIds:           Set|Array of column ids whose volume is covered by BBS
  //   excludeBeamIds:             Set|Array of beam ids covered by BBS
  //   excludeSlabIds:             Set|Array of slab ids covered by BBS
  //   excludeFoundationIds:       Set|Array of foundation entity ids covered by BBS
  //   excludeColumnTypeFootingIds: Set|Array of columnTypeIds whose inline footings are covered by BBS
  //
  // Excluded entities contribute 0 to the kg/m³ estimate for their category.
  // BBS for those entities is emitted by computeBBSQuantities() — boq/lines.js
  // combines the two so the user sees one estimate line + N BBS lines per category.
  getSteelQuantities: (opts = {}) => {
    const state = get()
    const steelRatios = state.projectSettings.rccSpecs?.steelKgPerM3 ?? STEEL_KG_PER_M3
    const { columns, slabs, foundations, projectSettings, nodes } = state
    const { columnTypes, beamDimensions, slabSettings } = projectSettings

    const toSet = (v) => v instanceof Set ? v : new Set(v ?? [])
    const exColumns      = toSet(opts.excludeColumnIds)
    const exBeams        = toSet(opts.excludeBeamIds)
    const exSlabs        = toSet(opts.excludeSlabIds)
    const exFoundations  = toSet(opts.excludeFoundationIds)
    const exInlineFooting = toSet(opts.excludeColumnTypeFootingIds)

    const toM3 = ft3 => ft3 * FT3_TO_M3

    // ── Columns: per-instance, drop excluded ───────────────────────────────
    let colFt3 = 0
    for (const col of Object.values(columns)) {
      if (exColumns.has(col.id)) continue
      // Phase ColumnStack — per-floor: resolved section × that floor's lift.
      for (const fid of topoGetColumnSpanFloorIds(state, col)) {
        const ct = resolveColumnTypeForColumn(state, col, columnTypes, fid)
        if (!ct) continue
        colFt3 += getColumnAreaFt2(ct) * topoGetColumnLiftHeightFt(state, col, fid)
      }
    }

    // ── Beams: per-instance (explicit + wall-derived), drop excluded ───────
    let beamFt3 = 0
    for (const b of state.getAllBeams()) {
      if (exBeams.has(b.id)) continue
      const dims = beamDimensions[b.level]
      if (!dims) continue
      const from = topoResolveBeamEndpoint(state, b.endpoints.from)
      const to   = topoResolveBeamEndpoint(state, b.endpoints.to)
      if (!from || !to) continue
      const lenFt = Math.hypot(to.x - from.x, to.y - from.y) / 12
      beamFt3 += lenFt * (dims.widthIn / 12) * (dims.depthIn / 12)
    }

    // ── Slabs: per-instance when slabs map non-empty; fallback derives from rooms.
    let slabFt3 = 0
    if (Object.keys(slabs).length === 0) {
      // Fallback path can't honor exclusion (no per-slab id exists yet).
      const slabQtys = state.getSlabQuantities()
      slabFt3 = slabQtys.mainVolFt3 + slabQtys.sunkenVolFt3
    } else {
      const validSet = new Set(state.getValidRoomIds())
      for (const slab of Object.values(slabs)) {
        if (exSlabs.has(slab.id)) continue
        let areaFt2 = 0
        for (const rid of (slab.roomIds ?? [])) {
          if (!validSet.has(rid)) continue
          areaFt2 += state.getRoomArea?.(rid) ?? 0
        }
        const isSunken = slab.type === 'SUNKEN'
        const thickIn = (isSunken
          ? slabSettings.mainThicknessIn + slabSettings.sunkenDepthIn
          : slabSettings.mainThicknessIn)
        slabFt3 += areaFt2 * thickIn / 12
      }
    }

    // ── Footings: drop excluded foundations + inline buckets ───────────────
    const fdnQtys = state.getFoundationQuantities()
    let footFt3 = 0
    for (const [fid, q] of Object.entries(fdnQtys.byFoundation)) {
      if (exFoundations.has(fid)) continue
      footFt3 += q.concreteVolFt3
    }
    for (const [ctId, q] of Object.entries(fdnQtys.byColumnTypeInline)) {
      if (exInlineFooting.has(ctId)) continue
      footFt3 += q.concreteVolFt3
    }

    // ── Staircase + civil — never covered by BBS today, full estimate ──────
    const stairQtys = state.getStaircaseQuantities()
    const sumpQty   = state.getSumpCivilQty?.()   ?? { rccBottomFt3: 0, rccTopFt3: 0 }
    const septicQty = state.getSepticCivilQty?.() ?? { rccBottomFt3: 0, rccTopFt3: 0 }
    const stairM3 = toM3(stairQtys.reduce((s, q) => s + q.totalRccFt3, 0))
    const civilM3 = toM3(sumpQty.rccBottomFt3 + sumpQty.rccTopFt3 + septicQty.rccBottomFt3 + septicQty.rccTopFt3)

    const footM3 = toM3(footFt3)
    const colM3  = toM3(colFt3)
    const beamM3 = toM3(beamFt3)
    const slabM3 = toM3(slabFt3)

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
    return _concreteMemo([colQ, fdnQ, beamQ, slabQ, stairQ, sunQ], () => {

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

    return result
    })
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
    return _masonryDedMemo([walls, nodes, projectSettings], () => {
      const base = get().getMaterialQuantities?.()
      if (!base || Object.keys(base).length === 0) return base ?? {}

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

      if (Object.keys(deductions).length === 0) return base

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
      return result
    })
  },

  // Masonry brickwork split by wall thickness, for the work-quantity BOQ lines
  // (9″ → Cft, 4.5″ → Sft, other → Cft). Live-store (all-floors) sibling of the
  // scope.js getMasonryByThickness (floor + room scope). Mirrors the floor-scope
  // policy: every non-virtual / non-plot wall counted once (NO partition share
  // factor), with the same per-wall beam deduction as getMasonryWithBeamDeduction.
  // Shape: { [matKey]: { byThickness: { [thicknessIn]: { volFt3, faceAreaFt2 } } } }
  getMasonryByThickness: () => {
    const { walls, nodes, projectSettings } = get()
    const { beamDimensions } = projectSettings
    const acc = {}   // matKey → thicknessIn → { volFt3, faceAreaFt2 }
    for (const wall of Object.values(walls)) {
      if (wall.isVirtual || wall.isPlot) continue
      const matKey = wall.materialKey ?? 'IS_MODULAR_BRICK'
      const n1 = nodes[wall.n1], n2 = nodes[wall.n2]
      if (!n1 || !n2) continue
      const faceAreaFt2 = get().getWallArea(wall.id)
      const thicknessIn = wall.thickness ?? 9
      const thicknessFt = thicknessIn / 12
      const grossVol = faceAreaFt2 * thicknessFt

      // Per-wall beam deduction (same formula as getMasonryWithBeamDeduction).
      const flags = get().classifyWallBeamFlags(wall.id)
      const wallLenFt = Math.hypot(n2.x - n1.x, n2.y - n1.y) / 12
      const wallThickFt = thicknessFt
      let deductFt3 = 0
      for (const lvl of BEAM_LEVEL_REGISTRY) {
        if (!flags[lvl.flagName]) continue
        const dims = beamDimensions[lvl.id]
        if (!dims) continue
        deductFt3 += wallLenFt * Math.min(wallThickFt, dims.widthIn / 12) * (dims.depthIn / 12)
      }
      const netVol = Math.max(0, grossVol - deductFt3)

      if (!acc[matKey]) acc[matKey] = {}
      if (!acc[matKey][thicknessIn]) acc[matKey][thicknessIn] = { volFt3: 0, faceAreaFt2: 0 }
      acc[matKey][thicknessIn].volFt3 += netVol
      acc[matKey][thicknessIn].faceAreaFt2 += faceAreaFt2
    }
    const result = {}
    for (const [matKey, byThk] of Object.entries(acc)) {
      const byThickness = {}
      for (const [thk, q] of Object.entries(byThk)) {
        byThickness[thk] = { volFt3: r2(q.volFt3), faceAreaFt2: r2(q.faceAreaFt2) }
      }
      result[matKey] = { byThickness }
    }
    return result
  },
})
