// Toolbar tool registry — single source of truth for what the toolbar shows.
//
// Each cluster either has flat `items[]` (rendered in order) or `groups[]`
// (each with its own sub-header + nested items[]).
//
// Item kinds:
//   - 'tool'      → switches activeTool to toolId via setTool(toolId).
//   - 'toggle'    → flips a boolean store key (storeKey).
//                   Optional `path` (e.g. 'projectSettings.snap.enabled') —
//                   when present, the value is read/written via a nested
//                   path rather than a flat top-level store key. The
//                   dispatcher in Toolbar.jsx maps known paths to their
//                   specialized setter.
//   - 'segmented' → sets a store key to one of N values.
//                   Optional `path` (same semantics as toggle) — when
//                   present, the value is read/written via a nested path
//                   through projectSettings.
//   - 'indicator' → read-only status display (no click handler). Used for
//                   surfaces like the snap badge: shows current state with
//                   an icon + label + optional keyboard-shortcut hint.
//                   The dispatcher in Toolbar.jsx renders by `indicatorId`.
//   - 'action'    → one-shot action; handler lives in Toolbar.jsx ACTION_HANDLERS.
//
// Adding a new tool = one entry here. No JSX changes needed in Toolbar.jsx.

import {
  Pencil,
  MousePointer2,
  Scissors,
  Hexagon,
  Square,
  Columns3,
  RectangleHorizontal,
  LayoutGrid,
  Anchor,
  Stamp,
  ArrowDownUp,
  Droplet,
  Zap,
  Wind,
  Flame,
  Cable,
  Container,
  Cylinder,
  Building2,
  Ruler,
  Settings as SettingsIcon,
  Tag,
  EyeOff,
  FolderOpen,
  History,
  Save,
  Upload,
  Download,
  Undo2,
  Redo2,
  Box,
  Image as ImageIcon,
  Crosshair,
  Trash2,
  Grid3X3,
  Magnet,
  Frame,
  Link,
  Table2,
} from 'lucide-react'

export const TOOL_CLUSTERS = Object.freeze([
  {
    id: 'draw',
    label: 'Draw',
    groups: [
      {
        title: 'Tools',
        items: [
          { type: 'tool', toolId: 'draw',        icon: Pencil,        label: 'Draw walls',     shortcut: 'D' },
          { type: 'tool', toolId: 'rect_room',   icon: Square,        label: 'Rectangle room', shortcut: 'Shift+R' },
          { type: 'tool', toolId: 'select',      icon: MousePointer2, label: 'Select',         shortcut: 'S' },
          { type: 'tool', toolId: 'split',       icon: Scissors,      label: 'Split wall' },
          { type: 'tool', toolId: 'room',        icon: Hexagon,       label: 'Room',           shortcut: 'R' },
          { type: 'tool', toolId: 'room_detect', icon: Frame,         label: 'Detect Room',    shortcut: 'Shift+A' },
          { type: 'tool', toolId: 'join_walls',  icon: Link,          label: 'Join walls',     shortcut: 'J' },
        ],
      },
      {
        // Face-aware draw reference (2026-05-28). Default 'inside_face'
        // matches Indian / RERA tracing convention (room labels are
        // clear-inside). Mid-trace switching handles plans where outer
        // perimeter is dimensioned outside-face. Centerline mode = legacy
        // (clicks are literal centerline coords).
        title: 'Drawing to',
        items: [
          {
            type:   'segmented',
            path:   'projectSettings.drawReference',
            options: [
              { value: 'inside_face',  label: 'Inside'  },
              { value: 'centerline',   label: 'Center'  },
              { value: 'outside_face', label: 'Outside' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'structural',
    label: 'Structural & Civil',
    groups: [
      {
        title: 'Structural',
        items: [
          { type: 'tool', toolId: 'column',      icon: Columns3,            label: 'Column' },
          { type: 'tool', toolId: 'beam',        icon: RectangleHorizontal, label: 'Beam' },
          { type: 'tool', toolId: 'slabs',       icon: LayoutGrid,          label: 'Slabs' },
          { type: 'tool', toolId: 'foundations', icon: Anchor,              label: 'Foundations' },
        ],
      },
      {
        title: 'Civil',
        items: [
          { type: 'tool', toolId: 'stairs',        icon: Stamp,       label: 'Stairs' },
          { type: 'tool', toolId: 'lift',          icon: ArrowDownUp, label: 'Lift' },
          { type: 'tool', toolId: 'sump',          icon: Droplet,     label: 'Sump' },
          { type: 'tool', toolId: 'overhead_tank', icon: Container,   label: 'Overhead tank' },
          { type: 'tool', toolId: 'septic_tank',   icon: Cylinder,    label: 'Septic tank' },
        ],
      },
    ],
  },
  {
    id: 'mep',
    label: 'MEP',
    items: [
      { type: 'tool', toolId: 'plumbing',   icon: Droplet, label: 'Plumbing',   shortcut: 'P' },
      { type: 'tool', toolId: 'electrical', icon: Zap,     label: 'Electrical', shortcut: 'E' },
      { type: 'tool', toolId: 'hvac',       icon: Wind,    label: 'HVAC',       shortcut: 'H' },
      { type: 'tool', toolId: 'fire',       icon: Flame,   label: 'Fire',       shortcut: 'F' },
      { type: 'tool', toolId: 'elv',        icon: Cable,   label: 'ELV',        shortcut: 'L' },
    ],
  },
  {
    id: 'view',
    label: 'View & Settings',
    groups: [
      {
        title: 'Tools',
        items: [
          { type: 'tool', toolId: 'floors',   icon: Building2,    label: 'Floors' },
          { type: 'tool', toolId: 'bbs',           icon: Ruler,        label: 'BBS' },
          { type: 'tool', toolId: 'bbs_schedule',  icon: Table2,       label: 'BBS Schedule', shortcut: 'Shift+B' },
          { type: 'tool', toolId: 'iso',      icon: Box,          label: '3D View', shortcut: 'Ctrl+3' },
          { type: 'tool', toolId: 'settings', icon: SettingsIcon, label: 'Settings' },
        ],
      },
      {
        title: 'Toggles',
        items: [
          { type: 'toggle', storeKey: 'showDimensions', icon: Tag,    label: 'Show dimensions' },
          { type: 'toggle', storeKey: 'drawVirtual',    icon: EyeOff, label: 'Draw virtual walls' },
        ],
      },
      {
        // Phase A Task 5 — snap quick-controls. Toolbar surfaces ONLY the
        // pitch segmented + a status indicator. Every other snap setting
        // (enabled toggle, bypass key, per-target enable, tolerances) lives
        // in ProjectSettingsPanel → Snap section. F9 toggles snap globally.
        title: 'Snap',
        items: [
          {
            type:    'segmented',
            path:    'projectSettings.snap.pitchIn',
            action:  'setSnapPitch',
            icon:    Grid3X3,
            options: [
              { value: 1,  label: '1"'  },
              { value: 3,  label: '3"'  },
              { value: 6,  label: '6"'  },
              { value: 12, label: '12"' },
              { value: 24, label: '24"' },
            ],
          },
          {
            type:        'indicator',
            indicatorId: 'snap',
            icon:        Magnet,
            shortcut:    'F9',
          },
        ],
      },
      {
        // Phase 4 Tier-2 Step 18 — underlay workflow.
        title: 'Underlay',
        items: [
          { type: 'action', actionId: 'underlay_import',    icon: ImageIcon, label: 'Import PDF / image…' },
          { type: 'tool',   toolId:   'calibrate_underlay', icon: Crosshair, label: 'Calibrate scale' },
          { type: 'action', actionId: 'underlay_clear',     icon: Trash2,    label: 'Clear underlay' },
        ],
      },
      {
        title: 'Units',
        items: [
          { type: 'segmented', storeKey: 'unit', options: [
            { value: 'ft',    label: 'ft'    },
            { value: 'ft-in', label: 'ft-in' },
            { value: 'm',     label: 'm'     },
          ] },
        ],
      },
    ],
  },
  {
    id: 'project',
    label: 'Project',
    items: [
      { type: 'tool',   toolId: 'projects',  icon: FolderOpen, label: 'Open project list' },
      { type: 'tool',   toolId: 'revisions', icon: History,    label: 'Revisions' },
      { type: 'action', actionId: 'save',    icon: Save,       label: 'Save project', shortcut: 'Ctrl+S' },
      { type: 'action', actionId: 'import',  icon: Upload,     label: 'Import JSON' },
      { type: 'action', actionId: 'export',  icon: Download,   label: 'Export JSON' },
      { type: 'action', actionId: 'undo',    icon: Undo2,      label: 'Undo',         shortcut: 'Ctrl+Z' },
      { type: 'action', actionId: 'redo',    icon: Redo2,      label: 'Redo',         shortcut: 'Ctrl+Y' },
    ],
  },
])

// Helper: walk a cluster (flat or grouped) and return every toolId it contains.
// Used to decide whether a cluster trigger should render with the primary tint
// (i.e. activeTool is one of this cluster's tools).
export function collectToolIds(cluster) {
  const ids = []
  const visit = items => {
    for (const item of items) {
      if (item.type === 'tool') ids.push(item.toolId)
    }
  }
  if (cluster.items) visit(cluster.items)
  if (cluster.groups) for (const g of cluster.groups) visit(g.items)
  return ids
}
