// Keeps `state.derivedMembers` (the permanent identity of derived structural members,
// topology/derivedMembers.js, erp-saas D-280) in step with the drawing, IN THE SAME
// COMMIT as the change that moves it: a wall split, an opening move or a column delete
// and the members they reach land as one store state, so the sync coordinator, the
// canonical document and undo history never see one without the other.
//
// Every write goes through it — the slices' `set` and `useStore.setState` alike. A
// change that touches none of the members' inputs passes through untouched. A change
// that carries its own registry (undo, redo, load) starts from that registry.

import { reconcileDerivedMembers } from '../topology/derivedMembers.js'

const INPUTS = ['walls', 'nodes', 'columns', 'rooms', 'foundations', 'beams', 'projectSettings', 'derivedMembers']

export function withDerivedMembers(prev, patch) {
  if (!patch || typeof patch !== 'object' || !INPUTS.some((k) => k in patch)) return patch
  const next = { ...prev, ...patch }
  const carried = 'derivedMembers' in patch
  const base = carried ? patch.derivedMembers : prev.derivedMembers
  const registry = reconcileDerivedMembers(base, carried ? null : prev, next)
  return registry === base && !carried ? patch : { ...patch, derivedMembers: registry }
}

export const derivedMembersMiddleware = (config) => (set, get, api) => {
  const write = (partial, replace) =>
    set((s) => withDerivedMembers(s, typeof partial === 'function' ? partial(s) : partial), replace)
  api.setState = write
  return config(write, get, api)
}
