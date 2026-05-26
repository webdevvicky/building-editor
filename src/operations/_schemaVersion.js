// Single source of truth for SCHEMA_VERSION — the integer that stamps
// every dispatched operation + every persisted project save.
//
// Lives in src/operations/ (not src/projects/) because operations depend
// on it at module load; persistence is a downstream consumer that re-exports.
//
// Migration chain (Arch 5) lives in src/projects/schemaVersion.js and
// imports this constant. Bumped whenever any schema shape changes.

// Phase 1 baseline = 8 (post BOQ Gaps 1-8 + per-room tile overrides +
// IFC GlobalId backfill + entity schemas).
export const SCHEMA_VERSION = 8
