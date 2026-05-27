// Compute module barrel — Arch 3 Phase 3.

export {
  defineComputation, runComputation,
  getComputation, listComputations, listComputationIds, listComputationsByClass,
  validateDagAcyclic,
  COMPUTE_CLASS, COMPUTE_CLASSES_ORDERED, isValidComputeClass,
  _resetCache, _clearRegistry,
} from './registry.js'

export {
  recordCompute, isProfileEnabled, enableProfile, disableProfile,
  getProfile, resetProfile, printProfile,
} from './profile.js'
