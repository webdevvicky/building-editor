// Single source for IFC class lookup.
//
// Discipline modules pass entities/routes/risers in here and receive the IFC
// class name (and PredefinedType where relevant) for downstream Phase 3 IFC
// export. Centralizing this avoids string-literal sprawl across the
// codebase.
//
// The catalog-side ifcClasses.js (when it lands) will host the per-type
// table. Until then, the entity's own ifcType attribute is the source of
// truth — every fixture/point registry entry already carries one.

// Best-effort dynamic import of the catalog's getIfcClass. The catalog
// module may not exist yet; in that case we fall back to entity.ifcType.
let _catalogGetIfcClass = null
try {
  // eslint-disable-next-line import/no-unresolved
  const mod = await import('../catalogs/ifcClasses.js').catch(() => null)
  if (mod && typeof mod.getIfcClass === 'function') {
    _catalogGetIfcClass = mod.getIfcClass
  }
} catch {
  _catalogGetIfcClass = null
}

// ── Entity → IFC class ──────────────────────────────────────────────────────

export function mapEntityToIfcClass(entity) {
  if (!entity) return 'IfcBuildingElementProxy'
  if (_catalogGetIfcClass) {
    const fromCatalog = _catalogGetIfcClass(entity.type)
    if (fromCatalog) return fromCatalog
  }
  if (entity.ifcType) return entity.ifcType
  // Discipline-keyed fallback.
  switch (entity.discipline) {
    case 'PLUMBING':   return 'IfcSanitaryTerminal'
    case 'ELECTRICAL': return 'IfcOutlet'
    case 'HVAC':       return 'IfcUnitaryEquipment'
    case 'FIRE':       return 'IfcFireSuppressionTerminal'
    case 'ELV':        return 'IfcAudioVisualAppliance'
    case 'SOLAR':      return 'IfcSolarDevice'
    default:           return 'IfcBuildingElementProxy'
  }
}

// ── Route → IFC class ───────────────────────────────────────────────────────

export function mapRouteToIfcClass(route) {
  if (!route) return 'IfcBuildingElementProxy'
  const discipline = route.discipline ?? null
  const systemType = route.systemType ?? route.kind ?? null

  if (discipline === 'PLUMBING') return 'IfcPipeSegment'
  if (discipline === 'FIRE')     return 'IfcPipeSegment'
  if (discipline === 'HVAC') {
    // HVAC ducted = IfcDuctSegment; refrigerant line set = IfcPipeSegment.
    if (systemType === 'REFRIGERANT' || systemType === 'CONDENSATE') {
      return 'IfcPipeSegment'
    }
    return 'IfcDuctSegment'
  }
  if (discipline === 'ELECTRICAL' || discipline === 'ELV' || discipline === 'SOLAR') {
    // Wiring = IfcCableSegment; conduit/trunking = IfcCableCarrierSegment.
    if (systemType === 'CONDUIT' || systemType === 'TRUNKING') {
      return 'IfcCableCarrierSegment'
    }
    return 'IfcCableSegment'
  }
  return 'IfcBuildingElementProxy'
}

// ── Riser → IFC class ───────────────────────────────────────────────────────

export function mapRiserToIfcClass(riser) {
  if (!riser) return { ifcClass: 'IfcBuildingElementProxy', predefinedType: null }
  const kind = riser.kind ?? null
  // Plumbing / fire risers → IfcPipeSegment + PredefinedType:RISER.
  if (
    kind === 'PLUMBING_SUPPLY' ||
    kind === 'SOIL_STACK' ||
    kind === 'RAINWATER_DOWN' ||
    kind === 'HOT_WATER_RISER' ||
    kind === 'FIRE_MAIN' ||
    kind === 'HVAC_REFRIGERANT' ||
    kind === 'HVAC_CONDENSATE'
  ) {
    return { ifcClass: 'IfcPipeSegment', predefinedType: 'RISER' }
  }
  // Electrical / ELV / solar → IfcCableCarrierSegment + PredefinedType:RISER.
  if (
    kind === 'ELECTRICAL_SUBMAIN' ||
    kind === 'ELV_TRUNKING' ||
    kind === 'SOLAR_DC_RISER' ||
    kind === 'SOLAR_AC_RISER'
  ) {
    return { ifcClass: 'IfcCableCarrierSegment', predefinedType: 'RISER' }
  }
  return { ifcClass: 'IfcBuildingElementProxy', predefinedType: null }
}
