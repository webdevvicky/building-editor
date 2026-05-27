export const DEFAULT_LAYER_VISIBILITY = Object.freeze({
  // ---------- Underlay (PDF/image background) ----------
  underlay:   true,  // Phase 4 Tier-2 Steps 16-17 — hidden when no underlay is loaded.

  // ---------- Structural ----------
  walls:      true,
  columns:    true,
  beams:      true,
  stamps:     true,
  slabs:      false,  // Phase 4 Tier-2 Item 29 — off by default (plan-view
                      //   clutter); engineers toggle on for QA / clash review.
  roomFills:  true,
  roomLabels: true,
  nodes:      true,

  // ---------- MEP base entities ----------
  plumbingFixtures:   true,
  electricalPoints:   true,
  hvacUnits:          true,
  fireDevices:        true,
  elvDevices:         true,
  solarEquipment:     true,
  risers:             true,

  // ---------- MEP routes (granular — engineers toggle per discipline) ----------
  plumbingSupplyRoutes:    true,
  plumbingDrainageRoutes:  true,
  plumbingHotWaterRoutes:  false,  // off by default — usually empty in Phase 1
  plumbingRainwaterRoutes: false,  // off until Phase 2.4 ships rainwater
  electricalWiringRoutes:  true,
  electricalSubmainRoutes: true,
  hvacRefrigerantRoutes:   true,
  hvacCondensateRoutes:    true,
  fireDetectionRoutes:     true,
  fireSprinklerRoutes:     true,
  elvCctvRoutes:           true,
  elvDataRoutes:           true,
  solarDcRoutes:           true,
  solarAcRoutes:           true,

  // ---------- Cross-discipline diagnostics ----------
  clashes:                 true,
})
