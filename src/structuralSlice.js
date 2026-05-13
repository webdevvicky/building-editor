// Structural BOQ state slice.
// Usage: spread into the main Zustand create() call.
//   export const useStore = create((set, get) => ({
//     ...existingState,
//     ...createStructuralSlice(set, get, uid),
//   }))
// `uid` is the store-level ID generator (same counter as nodes/walls/rooms/stamps).

export const DEFAULT_COLUMN_TYPES = [
  { id: 'C1', label: 'Corner 9×9',    widthIn: 9,  depthIn: 9,  shape: 'rect',   footingTypeId: 'F1' },
  { id: 'C2', label: 'External 9×12', widthIn: 9,  depthIn: 12, shape: 'rect',   footingTypeId: 'F2' },
  { id: 'C3', label: 'Heavy 12×12',   widthIn: 12, depthIn: 12, shape: 'rect',   footingTypeId: 'F3' },
  { id: 'C4', label: 'Circular Φ12',  diamIn: 12,              shape: 'circle', footingTypeId: 'F2' },
]

export const DEFAULT_FOOTING_TYPES = [
  { id: 'F1', label: 'Light 3×3×1',    lengthFt: 3, widthFt: 3, depthFt: 1    },
  { id: 'F2', label: 'Standard 4×4×1', lengthFt: 4, widthFt: 4, depthFt: 1    },
  { id: 'F3', label: 'Heavy 5×5×1.25', lengthFt: 5, widthFt: 5, depthFt: 1.25 },
]

export const DEFAULT_PROJECT_SETTINGS = {
  mortarRatio: '1:6',
  wastagePercent: 5,
  plasterThicknessMm: { internal: 12, ceiling: 10, external: 15 },

  // Explicit floor heights — column height = plinthHeightFt + floorHeightFt + slabThicknessIn/12
  // TODO Phase 2: Multi-floor support will multiply this per floor count.
  heights: {
    plinthHeightFt: 1.5,
    floorHeightFt: 10,
  },

  columnTypes: DEFAULT_COLUMN_TYPES,
  footingTypes: DEFAULT_FOOTING_TYPES,

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

  selectedColumnId: null,

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

  setFootingTypeEntry: (id, fields) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      footingTypes: state.projectSettings.footingTypes.map(ft =>
        ft.id === id ? { ...ft, ...fields } : ft
      ),
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

  setHeights: (partial) => set(state => ({
    projectSettings: {
      ...state.projectSettings,
      heights: { ...state.projectSettings.heights, ...partial },
    },
  })),

  // ── Column actions ─────────────────────────────────────────────────────────

  addColumn: (x, y, columnTypeId, attachedNodeId = null) => {
    const id = uid()
    get()._save()
    set(state => ({
      columns: { ...state.columns, [id]: { id, x, y, columnTypeId, attachedNodeId } },
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
      return { columns: nextColumns, beams: nextBeams }
    })
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

  // ── Beam actions ───────────────────────────────────────────────────────────

  addBeam: (fromColumnId, toColumnId, level) => {
    const id = uid()
    get()._save()
    set(state => ({
      beams: {
        ...state.beams,
        [id]: {
          id,
          endpoints: {
            from: { type: 'COLUMN', columnId: fromColumnId },
            to:   { type: 'COLUMN', columnId: toColumnId },
          },
          level,
          source: 'EXPLICIT',
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

  addSlab: (type, roomIds, thicknessIn, sinkDepthIn = 0) => {
    const id = uid()
    get()._save()
    set(state => ({
      slabs: {
        ...state.slabs,
        [id]: { id, type, roomIds: [...roomIds], thicknessIn, sinkDepthIn, grade: 'M20' },
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

    const sunkenRoomIds = validIds.filter(id => {
      const room = state.rooms[id]
      return room && autoSunkenRoomTypes.includes(room.type)
    })
    const mainRoomIds = validIds.filter(id => !sunkenRoomIds.includes(id))

    const newSlabs = {}

    if (mainRoomIds.length > 0) {
      const mainId = uid()
      newSlabs[mainId] = { id: mainId, type: 'MAIN', roomIds: mainRoomIds, thicknessIn: mainThicknessIn, sinkDepthIn: 0, grade: 'M20' }
    }

    for (const roomId of sunkenRoomIds) {
      const sunkenId = uid()
      newSlabs[sunkenId] = { id: sunkenId, type: 'SUNKEN', roomIds: [roomId], thicknessIn: mainThicknessIn, sinkDepthIn: sunkenDepthIn, grade: 'M20' }
    }

    set({ slabs: newSlabs })
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

  // ── Selectors (stubs — implemented in commit 3) ───────────────────────────

  // Returns in-memory WALL_DERIVED beam entities (not persisted).
  // Stub: commit 3 fills this in.
  getDerivedWallBeams: () => [],

  // Merges EXPLICIT beams (from store) + WALL_DERIVED beams (in-memory).
  // All BOQ, canvas render, and CSV export consume this — single code path.
  // Stub: commit 3 fills this in.
  getAllBeams: () => {
    return Object.values(get().beams)
  },

  // Stub selectors — all return empty/zero until commit 3.
  getColumnQuantities:         () => ({}),
  getFootingQuantities:         () => ({}),
  getBeamQuantities:           () => ({ plinth: null, lintel: null, roof: null }),
  getSlabQuantities:           () => ({ mainAreaFt2: 0, mainVolFt3: 0, sunkenAreaFt2: 0, sunkenVolFt3: 0, sunkenRooms: [] }),
  getStaircaseQuantities:      () => ([]),
  getSunshadeQuantities:       () => ({ count: 0, totalVolFt3: 0 }),
  getParapetQuantities:        () => ({ totalLenFt: 0, heightFt: 0, thicknessIn: 0, totalVolFt3: 0, materialKey: '' }),
  getSteelQuantities:          () => ({ footing: 0, column: 0, beam: 0, slab: 0, staircase: 0, civilStamp: 0, total: 0 }),
  getConcreteByGrade:          () => ({}),
  getMasonryWithBeamDeduction: () => get().getMaterialQuantities?.() ?? {},
  getWallAdjacencyCount:       () => ({}),
  classifyWallBeamFlags:       (_wallId) => ({ hasPlinthBeam: false, hasLintelBeam: false, hasRoofBeam: false }),
})
