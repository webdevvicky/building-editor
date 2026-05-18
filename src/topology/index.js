// Topology layer — canonical, read-only spatial-relationship APIs.
//
// Discipline engines (structural BOQ, MEP, interiors, fabrication) consume
// this layer; they never recompute spatial relationships.
//
// - Pure geometry math lives in src/geometry.js (point-in-polygon, segment
//   intersection, snap, etc.). Topology USES geometry — it isn't geometry.
// - State-reading relationships live here. Each module owns one kind of
//   relationship (rooms, walls, openings, columns, beams, foundations,
//   floor scope, adjacency, surfaces, wet walls).
// - No store mutations. Ever.
// - Memoization via createMemo() in ./cache.js — reference equality only.

export { createMemo } from './cache.js'
