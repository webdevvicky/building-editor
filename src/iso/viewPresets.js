// Camera-view presets for the iso viewer. Single source of truth for the
// preset angles surfaced in the IsoView Camera sidebar — IsoView never
// hardcodes degrees, it imports from here.
//
// Azimuth convention: compass-style, in degrees. 0 = north, 90 = east,
// 180 = south, 270 = west. The camera sits at that compass bearing from
// the building centre and looks back toward it.
//
// The default elevation (30°) matches engineering 30°-iso convention.
// IsoView clamps interactive elevation to [10°, 70°].

export const DEFAULT_ELEVATION_DEG = 30

export const ELEVATION_MIN_DEG = 10
export const ELEVATION_MAX_DEG = 70

// Four iso corner presets — these are the standard architectural views.
// Order matches NE → SE → SW → NW (clockwise around the compass).
export const ISO_PRESETS = Object.freeze([
  Object.freeze({ id: 'NE', label: 'NE', azimuthDeg:  45, elevationDeg: DEFAULT_ELEVATION_DEG }),
  Object.freeze({ id: 'SE', label: 'SE', azimuthDeg: 135, elevationDeg: DEFAULT_ELEVATION_DEG }),
  Object.freeze({ id: 'SW', label: 'SW', azimuthDeg: 225, elevationDeg: DEFAULT_ELEVATION_DEG }),
  Object.freeze({ id: 'NW', label: 'NW', azimuthDeg: 315, elevationDeg: DEFAULT_ELEVATION_DEG }),
])

// Top-down plan preset. Azimuth=0 means north points up on screen, which
// is the standard architectural plan orientation. Elevation=90 triggers
// projection.js's plan-projection special case.
export const TOP_PRESET = Object.freeze({
  id: 'TOP', label: 'Top', azimuthDeg: 0, elevationDeg: 90,
})

// Four cardinal presets — useful for inspecting a single building face.
// At cardinal azimuths, two side walls fold flat onto each other in the
// projection; engineers use these to read elevations of a single facade.
export const CARDINAL_PRESETS = Object.freeze([
  Object.freeze({ id: 'N', label: 'N', azimuthDeg:   0, elevationDeg: DEFAULT_ELEVATION_DEG }),
  Object.freeze({ id: 'E', label: 'E', azimuthDeg:  90, elevationDeg: DEFAULT_ELEVATION_DEG }),
  Object.freeze({ id: 'S', label: 'S', azimuthDeg: 180, elevationDeg: DEFAULT_ELEVATION_DEG }),
  Object.freeze({ id: 'W', label: 'W', azimuthDeg: 270, elevationDeg: DEFAULT_ELEVATION_DEG }),
])

// The view IsoView opens in. Matches the historical fixed-iso behaviour.
export const DEFAULT_VIEW = Object.freeze({ azimuthDeg: 45, elevationDeg: DEFAULT_ELEVATION_DEG })
