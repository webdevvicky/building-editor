// scripts/verify-catalog-provenance.mjs
//
// Arch 5 Phase 2 — catalog manifest + drift detection.
//
// Assertions:
//   - getAllCatalogVersions returns a frozen manifest with required keys
//   - diffCatalogManifests: identical = no diffs
//   - diffCatalogManifests: nested change detected (e.g. mep.fixtures
//     bumped to a newer version)
//   - flattenManifest: produces a flat path→version map
//   - Every catalog file in src/specs/ + src/mep/catalogs/ exporting
//     CATALOG_VERSION is included in the manifest (or whitelisted).

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  getAllCatalogVersions, diffCatalogManifests, flattenManifest,
} from '../src/specs/catalogManifest.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

// ── 1. Manifest shape ─────────────────────────────────────────────────
const manifest = getAllCatalogVersions()
check('getAllCatalogVersions returns frozen object', Object.isFrozen(manifest))
check('manifest has schemaRev', typeof manifest.schemaRev === 'string')
check('manifest has paint version', typeof manifest.paint === 'string' && manifest.paint.length > 0)
check('manifest has ceilingFinish version', typeof manifest.ceilingFinish === 'string')
check('manifest has hardwareItems version', typeof manifest.hardwareItems === 'string')
check('manifest has hardwareSets version', typeof manifest.hardwareSets === 'string')
check('manifest has mep nested object',
      manifest.mep && typeof manifest.mep === 'object')
check('manifest.mep is frozen', Object.isFrozen(manifest.mep))
check('manifest.mep has fixtures version', typeof manifest.mep.fixtures === 'string')
check('manifest.mep has wireGauges version', typeof manifest.mep.wireGauges === 'string')

// ── 2. diffCatalogManifests: identity ─────────────────────────────────
const m2 = getAllCatalogVersions()
const noDiff = diffCatalogManifests(manifest, m2)
check('diff: identical manifests → changed=false',
      noDiff.changed === false && noDiff.diffs.length === 0)

// ── 3. diffCatalogManifests: nested change ────────────────────────────
const mutated = {
  ...manifest,
  paint: 'paint-future-version',
  mep:   { ...manifest.mep, fixtures: 'fixtures-future-version' },
}
const withDiff = diffCatalogManifests(manifest, mutated)
check('diff: nested mep.fixtures change detected',
      withDiff.changed === true &&
      withDiff.diffs.some(d => d.path === 'mep.fixtures' &&
                                d.was === manifest.mep.fixtures &&
                                d.now === 'fixtures-future-version'))
check('diff: top-level paint change detected',
      withDiff.diffs.some(d => d.path === 'paint' &&
                                d.now === 'paint-future-version'))

// ── 4. diffCatalogManifests: no saved manifest ────────────────────────
const fresh = diffCatalogManifests(null, manifest)
check('diff: null saved → changed=true',
      fresh.changed === true && fresh.diffs.length >= 1)

// ── 5. flattenManifest produces path → version map ────────────────────
const flat = flattenManifest(manifest)
check('flattenManifest: has paint key',
      flat.paint === manifest.paint)
check('flattenManifest: has nested mep.fixtures',
      flat['mep.fixtures'] === manifest.mep.fixtures)
check('flattenManifest: no nested objects in output',
      Object.values(flat).every(v => typeof v !== 'object'))

// ── 6. Every catalog file with CATALOG_VERSION is in manifest ────────
// Walk src/specs + src/mep/catalogs, find files exporting CATALOG_VERSION,
// assert each is represented in the manifest (catalog version surfaces
// somewhere). This catches the "new catalog added without registering" bug.
const SRC_ABS = process.platform === 'win32'
  ? new URL('../src', import.meta.url).pathname.replace(/^\//, '')
  : '/' + new URL('../src', import.meta.url).pathname.replace(/^\//, '')

async function walk(dir, files = []) {
  const ents = await readdir(dir, { withFileTypes: true })
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, files)
    else if (/\.(js|jsx|mjs)$/.test(e.name)) files.push(p)
  }
  return files
}

const allFiles = await walk(SRC_ABS)
const flatValues = new Set(Object.values(flat))
const RE_VERSION_EXPORT = /export\s+const\s+CATALOG_VERSION\s*=\s*['"]([^'"]+)['"]/

const missing = []
for (const f of allFiles) {
  const content = await readFile(f, 'utf8')
  const match = content.match(RE_VERSION_EXPORT)
  if (!match) continue
  const version = match[1]
  if (!flatValues.has(version)) {
    missing.push(`${f} (CATALOG_VERSION="${version}")`)
  }
}

if (missing.length === 0) {
  passed.push(`Every catalog with CATALOG_VERSION is included in the manifest`)
} else {
  failed.push(`Catalogs missing from manifest:`)
  for (const m of missing) failed.push(`   ${m}`)
}

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-catalog-provenance passed.')
