// Snap module barrel.
//
// Public surface for the unified snap architecture. Consumers (Canvas,
// verify-snap) import from here; the internal split between
// targets/toolPolicy/candidates/resolver is an implementation detail.

export { SNAP_TARGETS, SNAP_TARGET_IDS, buildDefaultTargetSettings, getSnapRef } from './targets.js'
export { TOOL_SNAP_POLICY, getToolPolicy, normalizePolicyEntry } from './toolPolicy.js'
export { findCandidates, findNearestCandidate } from './candidates.js'
export {
  resolveSnap,
  resolveSnapPoint,
  screenToWorldRaw,
  runPrepareForAllTargets,
  getTargetDescriptor,
  _resetPrepareState,
  _getPrepareController,
} from './resolver.js'
