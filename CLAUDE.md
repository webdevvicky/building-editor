# Building Editor — Developer Notes

## Phase 1.5 Backlog

- **Undo/redo can restore room-overlap state** that bypassed save-time prevention.
  Repro: Create Room 1 → Delete Room 1 → Create Room A in same space → Undo the delete.
  Room 1 + Room A now coexist without going through saveRoom's overlap check.
  Mitigated by defensive dedup in getTotalFloorArea (both rooms excluded from BOQ when
  structural-validity filter exposes the pair to the pairwise overlap loop).
  Address with broader revision/lifecycle work in Phase 1.5.
