// Catalog manifest aggregator — single function that snapshots the
// version string of every catalog the BOQ depends on.
//
// 2026-05-26 (Arch 5 Phase 2). Used by:
//   - Save path: stamps projectMeta.catalogProvenance with current versions
//   - Load path: compares saved vs current; surfaces drift warnings
//   - Excel + PDF cover: renders "Catalogs used: paint v..., ceiling v..." footer
//   - presentationModel.catalogVersionsUsed (Arch 5 wire-up)
//
// Catalogs covered:
//   - MEP (24 sub-catalogs via CATALOG_VERSIONS barrel in src/mep/catalogs/)
//   - Paint systems
//   - Ceiling finish systems
//   - Hardware items + sets
//   - Reinforcement specs
//   - Plaster systems
//   - Joinery subtype registry
//
// Adding a new catalog: ensure its module exports CATALOG_VERSION,
// then add an entry below. verify-catalog-provenance.mjs asserts
// every catalog file under src/ exporting CATALOG_VERSION is registered.

import { CATALOG_VERSIONS as MEP_CATALOG_VERSIONS } from '../mep/catalogs/index.js'
import { CATALOG_VERSION as PAINT_VERSION }    from './paintSystems.js'
import { CATALOG_VERSION as CEILING_VERSION }  from './ceilingFinishSystems.js'
import { CATALOG_VERSION as HW_ITEMS_VERSION } from './hardware/hardwareItems.js'
import { CATALOG_VERSION as HW_SETS_VERSION }  from './hardware/hardwareSets.js'
import { CATALOG_VERSION as IS2502_VERSION }   from './cuttingLength.js'

// Returns a frozen snapshot of every catalog version. Pure / deterministic.
// Call cost is one object construction; safe to call on every save.
export function getAllCatalogVersions() {
  return Object.freeze({
    schemaRev: '2026-05-26-V1',     // bumped if the manifest shape changes
    paint:           PAINT_VERSION,
    ceilingFinish:   CEILING_VERSION,
    hardwareItems:   HW_ITEMS_VERSION,
    hardwareSets:    HW_SETS_VERSION,
    is2502:          IS2502_VERSION,
    mep:             Object.freeze({ ...MEP_CATALOG_VERSIONS }),
  })
}

// Compare two manifests. Returns { changed: boolean, diffs: [{ path, was, now }] }.
// Used by the load path to detect drift and surface validation warnings.
export function diffCatalogManifests(saved, current) {
  if (!saved || typeof saved !== 'object') {
    return { changed: true, diffs: [{ path: '_root', was: null, now: 'present' }] }
  }
  const diffs = []
  // Walk current (we drift-check against the latest catalog versions).
  function walk(prefix, savedNode, currentNode) {
    for (const [k, v] of Object.entries(currentNode)) {
      const path = prefix ? `${prefix}.${k}` : k
      const savedVal = savedNode?.[k]
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        walk(path, savedVal ?? {}, v)
      } else if (savedVal !== v) {
        diffs.push({ path, was: savedVal ?? null, now: v })
      }
    }
  }
  walk('', saved, current)
  return { changed: diffs.length > 0, diffs }
}

// Flatten manifest to a key→version map (for display + audit log entries).
export function flattenManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return {}
  const out = {}
  function walk(prefix, node) {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        walk(path, v)
      } else {
        out[path] = v
      }
    }
  }
  walk('', manifest)
  return out
}
