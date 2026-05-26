// Numeric helpers — single home for rounding + finite-guard utilities.
//
// 2026-05-26 (Arch 8 Phase 1) — `safeR2` replaces the dozens of local
// `function r2(n) { return Math.round(n * 100) / 100 }` definitions
// scattered across quantities / formulas / BOQ. The legacy `r2` would
// return NaN for undefined / NaN input, which silently propagated into
// BOQ outputs. `safeR2` guards via Number.isFinite — any non-finite
// input returns 0.
//
// Behavior change vs legacy `r2`:
//   r2(undefined) → NaN          (old)
//   safeR2(undefined) → 0        (new)
//
// If a caller relied on NaN propagation (unlikely), the value flips to
// 0 instead. verify-boq catches numerical regressions.
//
// Future local `r2()` definitions are forbidden — verify-lints.mjs
// grep-guards. New code uses `safeR2` exclusively. Existing local `r2`
// definitions are migrated to `import { safeR2 as r2 } from ...` so
// callsites can stay unchanged.

// Round to 2 decimal places with non-finite input guard.
// Domain: any number; non-finite (NaN, +/-Infinity, undefined, null) → 0.
export function safeR2(n) {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

// Round to N decimal places. Same finite guard.
export function safeRound(n, decimals = 2) {
  if (!Number.isFinite(n)) return 0
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

// Identity guard — returns the number if finite, otherwise the fallback.
// Used when 0 isn't the right zero (e.g. divisors).
export function safeNum(n, fallback = 0) {
  return Number.isFinite(n) ? n : fallback
}

// Clamp + finite-guard combined.
export function safeClamp(n, min, max) {
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}
