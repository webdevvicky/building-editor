// Snapshot builder — pure function, no UI dependencies.
//
// Lives outside autosave.js so Node verify scripts can pull this without
// dragging in Toast.jsx (which Node's ESM loader can't parse).
//
// `version` is the ONE schema version (operations/_schemaVersion.js) — the canonical
// Building Document stored in the ERP carries the editor's real shape version (XR-14).

import { SCHEMA_VERSION } from '../operations/_schemaVersion.js'

export function buildSnapshot(s) {
  return {
    version:         SCHEMA_VERSION,
    nodes:           s.nodes,
    walls:           s.walls,
    rooms:           s.rooms,
    stamps:          s.stamps,
    columns:         s.columns,
    beams:           s.beams,
    slabs:           s.slabs,
    staircases:      s.staircases,
    foundations:     s.foundations,
    plumbingFixtures: s.plumbingFixtures ?? {},
    electricalPoints: s.electricalPoints ?? {},
    hvacUnits:        s.hvacUnits        ?? {},
    fireDevices:      s.fireDevices      ?? {},
    elvDevices:       s.elvDevices       ?? {},
    solarEquipment:   s.solarEquipment   ?? {},
    risers:           s.risers           ?? {},
    ratesByKey:      s.ratesByKey ?? {},
    projectSettings: s.projectSettings,
  }
}
