// scripts/verify-id-exposure.mjs
//
// Arch 6 / C8 ID exposure policy — exports / persistence / journals /
// revisions must NOT consume the internal `id` field. They must read
// `ifcGlobalId` only.
//
// This is a grep-style lint that fails CI when forbidden patterns
// appear in path-restricted directories.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

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

function lineNumbersMatching(content, regex) {
  const lines = content.split(/\r?\n/)
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() })
  }
  return hits
}

const files = await walk(SRC_ABS)
const passed = []
const failed = []

// Paths under which `entity.id` is forbidden (per C8 exposure policy).
// These directories serialize / share / export data — they MUST use ifcGlobalId.
//
// NOTE: Phase 1 ships the policy as a non-enforcing audit. Most existing
// code in these paths uses `entity.id` today. As Arch 1 (state separation)
// + Arch 2 (operation journal) + Arch 5 (IDB persistence) land, the offending
// callsites get migrated. This script ships in REPORT-ONLY mode for Phase 1
// and graduates to STRICT mode after Arch 5.
//
// KILL-SWITCH: after 2026-08-15 this script enforces strictly.
const RESTRICTED_PATHS = [
  join('src', 'export'),
  // TODO post-Arch-5: join('src', 'projects', 'storage'),
  // TODO post-Arch-2: join('src', 'operations'),
  // TODO post-Arch-5: join('src', 'revisions'),
]

// Patterns flagged by the policy.
// We intentionally use simple text matching — full AST analysis is
// overkill for the kind of mistakes this catches.
const FORBIDDEN_PATTERNS = [
  // Property access on common entity variable names
  /\b(wall|room|node|column|beam|slab|stamp|foundation|opening|staircase|fixture|point|unit|device)\.id\b/,
  // Bracket access patterns
  /entity\.id\b/,
]

const today = new Date()
const STRICT_AFTER = new Date('2026-08-15')
const strictMode = today > STRICT_AFTER

const offenders = []
for (const f of files) {
  const isRestricted = RESTRICTED_PATHS.some(p => f.includes(p))
  if (!isRestricted) continue
  const content = await readFile(f, 'utf8')
  for (const re of FORBIDDEN_PATTERNS) {
    for (const hit of lineNumbersMatching(content, re)) {
      // Skip comment lines (// or *)
      if (/^\s*(\/\/|\*)/.test(hit.text)) continue
      offenders.push(`${f}:${hit.line}  ${hit.text}`)
    }
  }
}

if (offenders.length === 0) {
  passed.push('No entity.id usage in restricted paths (export/)')
} else if (strictMode) {
  failed.push(`STRICT MODE (post ${STRICT_AFTER.toISOString().slice(0, 10)}): found ${offenders.length} entity.id usages in restricted paths:`)
  for (const o of offenders.slice(0, 30)) failed.push(`   ${o}`)
  if (offenders.length > 30) failed.push(`   ... and ${offenders.length - 30} more`)
} else {
  // Phase 1 report-only: pass with warning.
  passed.push(`Phase 1 report-only mode: ${offenders.length} entity.id usages in restricted paths`)
  console.log(`\n⚠️  ${offenders.length} entity.id usages found in restricted paths.`)
  console.log(`    Phase 1 report-only; STRICT after ${STRICT_AFTER.toISOString().slice(0, 10)}.`)
  console.log(`    Sample (first 10):`)
  for (const o of offenders.slice(0, 10)) console.log(`      ${o}`)
}

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-id-exposure passed.')
