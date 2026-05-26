// scripts/verify-lints.mjs
//
// Lint-style guards enforced as test assertions:
//
//   1. No local `function r2(n) { return Math.round(n * 100) / 100 }`
//      definitions outside src/lib/numbers.js. Use safeR2 (alias as r2
//      via import-rename if you want the short call site).
//
//   2. No raw `crypto.randomUUID()` calls outside src/lib/ids.js. Use
//      uid() / uidIfc() / newEntityIds() from src/lib/ids.js so the
//      stable-id contract holds (Arch 6 ID exposure policy).
//
// Both are mechanical grep guards. They keep new code on the contract
// without depending on ESLint plugin work.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const SRC_DIR = new URL('../src', import.meta.url).pathname.replace(/^\//, '')
// Windows path adjustment — Node URL gives leading slash on absolute paths.
const SRC_ABS = process.platform === 'win32'
  ? SRC_DIR
  : '/' + SRC_DIR

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
const failed = []
const passed = []

// ── Rule 1: no local r2 definitions outside src/lib/numbers.js ─────────────
// Patterns to flag:
//   function r2(...)
//   const r2 = (n) => ...
//   const r2 = function ...
//   let r2 = ...
const R2_DEF_PATTERNS = [
  /^\s*function\s+r2\s*\(/,
  /^\s*(const|let|var)\s+r2\s*=/,
]
const R2_OFFENDERS = []
for (const f of files) {
  if (f.endsWith(join('lib', 'numbers.js'))) continue   // canonical home — allowed
  const content = await readFile(f, 'utf8')
  for (const re of R2_DEF_PATTERNS) {
    for (const hit of lineNumbersMatching(content, re)) {
      R2_OFFENDERS.push(`${f}:${hit.line}  ${hit.text}`)
    }
  }
}
if (R2_OFFENDERS.length === 0) {
  passed.push('Rule 1: no local r2() definitions outside src/lib/numbers.js')
} else {
  failed.push(`Rule 1: found ${R2_OFFENDERS.length} local r2() definitions:`)
  for (const o of R2_OFFENDERS) failed.push(`   ${o}`)
}

// ── Rule 2: no raw crypto.randomUUID() outside src/lib/ids.js ─────────────
// Allowlist: known sites that Arch 6 (Step 2) replaces with uid() from
// src/lib/ids.js. REMOVE these entries after Arch 6 ships.
//
// KILL-SWITCH: after 2026-06-15, this allowlist must be empty.
//
// Each entry is a substring-match against the absolute file path.
const RULE_2_ALLOWLIST = [
  join('lib', 'ids.js'),                  // canonical home (post-Arch-6)
  join('projects', 'manager.js'),          // → uid() after Arch 6
  join('revisions', 'manager.js'),         // → uid() after Arch 6
  join('store.js'),                        // const uid = () => ... — replaced by import from lib/ids.js after Arch 6
]
const RANDOM_UUID = /\bcrypto\.randomUUID\s*\(/
const UUID_OFFENDERS = []
for (const f of files) {
  if (RULE_2_ALLOWLIST.some(suffix => f.endsWith(suffix))) continue
  const content = await readFile(f, 'utf8')
  for (const hit of lineNumbersMatching(content, RANDOM_UUID)) {
    UUID_OFFENDERS.push(`${f}:${hit.line}  ${hit.text}`)
  }
}
if (UUID_OFFENDERS.length === 0) {
  passed.push('Rule 2: no raw crypto.randomUUID() outside allowlist')
} else {
  failed.push(`Rule 2: found ${UUID_OFFENDERS.length} raw crypto.randomUUID() calls:`)
  for (const o of UUID_OFFENDERS) failed.push(`   ${o}`)
}

// Kill-switch check on Rule 2 allowlist.
const today = new Date()
const killDate = new Date('2026-06-15')
if (today > killDate && RULE_2_ALLOWLIST.length > 1) {
  failed.push(`Rule 2 KILL-SWITCH: allowlist must be empty after 2026-06-15 (today ${today.toISOString().slice(0, 10)}). Arch 6 missed deadline. Remove the manager.js / store.js entries from RULE_2_ALLOWLIST.`)
}

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-lints passed.')
