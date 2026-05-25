// Formalized _meta contract (Rev 2 Addition 2).
//
// Every aggregator under src/quantities/ AND every BOQ-related
// compute*Quantities function must return a `_meta` block built via
// buildMeta() below. Standard fields:
//
//   algorithm:           stable ID, e.g. 'ROOM_FACE_ACCUMULATION_V2'
//   calculationVersion:  date-tagged version, ticks each release
//   attributionPolicy:   how partition/shared-entity edge cases resolve
//   scoped:              true when called via boq/scope.js wrapper
//   generatedAt:         Date.now() forensic timestamp
//   ...extras            aggregator-specific introspection fields
//
// `_meta` is internal — never exported to PDF/Excel/CSV rows. It's for
// formula popovers, DevTools, and audit footers only.

export const ATTRIBUTION_POLICY = Object.freeze({
  HALF_PARTITION:  'HALF_PARTITION',   // partition walls split 50/50 between rooms
  DUAL_FACE:       'DUAL_FACE',        // partition walls counted on both inner faces
  INTERIOR_ONLY:   'INTERIOR_ONLY',    // partition walls counted only on owning room's face
  OWNING_ROOM:     'OWNING_ROOM',      // entity attributed to room owning its primary face
  NONE:            'NONE',             // not applicable (project-level aggregator)
})

// Detect whether the state object came through a boq/scope.js wrapper.
// Wrappers set one of these markers; the live store leaves them undefined.
export function isScopedState(state) {
  return Boolean(
    state?._scopedFloorId
    || state?._scopedRoomId
    || state?._scopedRoomType,
  )
}

// Build the standard _meta envelope.
//
//   buildMeta({
//     algorithm:          'GRILL_ROLLUP_V1',
//     calculationVersion: '2026-05-25',
//     attributionPolicy:  ATTRIBUTION_POLICY.OWNING_ROOM,
//     scoped:             isScopedState(state),
//     extras:             { perStaircase: [...], perBalcony: [...] },
//   })
export function buildMeta({ algorithm, calculationVersion, attributionPolicy, scoped, extras }) {
  return {
    algorithm,
    calculationVersion,
    attributionPolicy: attributionPolicy ?? ATTRIBUTION_POLICY.NONE,
    scoped:            scoped ?? false,
    generatedAt:       Date.now(),
    ...(extras ?? {}),
  }
}
