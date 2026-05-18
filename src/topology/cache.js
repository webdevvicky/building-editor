// Reference-equality memoization helper for topology selectors.
//
// Codifies the inline _xxxCache pattern used in structuralSlice.js into a
// single utility. Single-store assumption — one memo cell per module-level
// declaration, identity-keyed on dependency references.
//
// Usage:
//   const memo = createMemo()
//   function getThing(state) {
//     return memo([state.walls, state.nodes], () => compute(state))
//   }
//
// Guarantees:
//   - returns the same result reference when all dep references are unchanged
//   - recomputes when ANY dep reference differs
//   - dependency arity must be stable across calls

export function createMemo() {
  let lastDeps = null
  let lastResult
  return (deps, compute) => {
    if (
      lastDeps !== null &&
      lastDeps.length === deps.length &&
      lastDeps.every((d, i) => d === deps[i])
    ) {
      return lastResult
    }
    lastResult = compute()
    lastDeps = deps
    return lastResult
  }
}
