import { i18n } from '../../i18n/index'

export type ZoneColorTheme = {
  key: string
  accent: string
  accentHover: string
  soft: string
  border: string
  barFrom: string
  barTo: string
}

/** A–Z 大区色板：区分明显、适合运营面板 */
const LETTER_THEMES: Record<string, ZoneColorTheme> = {
  A: { key: 'a', accent: '#2563eb', accentHover: '#1d4ed8', soft: '#eff6ff', border: '#bfdbfe', barFrom: '#2563eb', barTo: '#60a5fa' },
  B: { key: 'b', accent: '#7c3aed', accentHover: '#6d28d9', soft: '#f5f3ff', border: '#ddd6fe', barFrom: '#7c3aed', barTo: '#a78bfa' },
  C: { key: 'c', accent: '#0891b2', accentHover: '#0e7490', soft: '#ecfeff', border: '#a5f3fc', barFrom: '#0891b2', barTo: '#22d3ee' },
  D: { key: 'd', accent: '#059669', accentHover: '#047857', soft: '#ecfdf5', border: '#a7f3d0', barFrom: '#059669', barTo: '#34d399' },
  E: { key: 'e', accent: '#ca8a04', accentHover: '#a16207', soft: '#fefce8', border: '#fde047', barFrom: '#ca8a04', barTo: '#facc15' },
  F: { key: 'f', accent: '#dc2626', accentHover: '#b91c1c', soft: '#fef2f2', border: '#fecaca', barFrom: '#dc2626', barTo: '#f87171' },
  G: { key: 'g', accent: '#9333ea', accentHover: '#7e22ce', soft: '#faf5ff', border: '#e9d5ff', barFrom: '#9333ea', barTo: '#c084fc' },
  H: { key: 'h', accent: '#ea580c', accentHover: '#c2410c', soft: '#fff7ed', border: '#fdba74', barFrom: '#ea580c', barTo: '#fb923c' },
  I: { key: 'i', accent: '#4f46e5', accentHover: '#4338ca', soft: '#eef2ff', border: '#c7d2fe', barFrom: '#4f46e5', barTo: '#818cf8' },
  J: { key: 'j', accent: '#0d9488', accentHover: '#0f766e', soft: '#f0fdfa', border: '#99f6e4', barFrom: '#0d9488', barTo: '#2dd4bf' },
  K: { key: 'k', accent: '#db2777', accentHover: '#be185d', soft: '#fdf2f8', border: '#fbcfe8', barFrom: '#db2777', barTo: '#f472b6' },
  L: { key: 'l', accent: '#65a30d', accentHover: '#4d7c0f', soft: '#f7fee7', border: '#bef264', barFrom: '#65a30d', barTo: '#a3e635' },
  M: { key: 'm', accent: '#0284c7', accentHover: '#0369a1', soft: '#f0f9ff', border: '#7dd3fc', barFrom: '#0284c7', barTo: '#38bdf8' },
  N: { key: 'n', accent: '#c026d3', accentHover: '#a21caf', soft: '#fdf4ff', border: '#f0abfc', barFrom: '#c026d3', barTo: '#e879f9' },
  O: { key: 'o', accent: '#d97706', accentHover: '#b45309', soft: '#fffbeb', border: '#fcd34d', barFrom: '#d97706', barTo: '#fbbf24' },
  P: { key: 'p', accent: '#16a34a', accentHover: '#15803d', soft: '#f0fdf4', border: '#86efac', barFrom: '#16a34a', barTo: '#4ade80' },
  Q: { key: 'q', accent: '#6366f1', accentHover: '#4f46e5', soft: '#eef2ff', border: '#c7d2fe', barFrom: '#6366f1', barTo: '#a5b4fc' },
  R: { key: 'r', accent: '#e11d48', accentHover: '#be123c', soft: '#fff1f2', border: '#fda4af', barFrom: '#e11d48', barTo: '#fb7185' },
  S: { key: 's', accent: '#2f8f87', accentHover: '#267a73', soft: '#e1f5f1', border: '#99d5cf', barFrom: '#2f8f87', barTo: '#5eb3ab' },
  T: { key: 't', accent: '#78716c', accentHover: '#57534e', soft: '#fafaf9', border: '#d6d3d1', barFrom: '#78716c', barTo: '#a8a29e' },
  U: { key: 'u', accent: '#0369a1', accentHover: '#075985', soft: '#f0f9ff', border: '#7dd3fc', barFrom: '#0369a1', barTo: '#0ea5e9' },
  V: { key: 'v', accent: '#9a3412', accentHover: '#7c2d12', soft: '#fff7ed', border: '#fdba74', barFrom: '#9a3412', barTo: '#ea580c' },
  W: { key: 'w', accent: '#4338ca', accentHover: '#3730a3', soft: '#eef2ff', border: '#a5b4fc', barFrom: '#4338ca', barTo: '#6366f1' },
  X: { key: 'x', accent: '#475569', accentHover: '#334155', soft: '#f8fafc', border: '#cbd5e1', barFrom: '#475569', barTo: '#64748b' },
  Y: { key: 'y', accent: '#a16207', accentHover: '#854d0e', soft: '#fefce8', border: '#fde047', barFrom: '#a16207', barTo: '#ca8a04' },
  Z: { key: 'z', accent: '#be123c', accentHover: '#9f1239', soft: '#fff1f2', border: '#fda4af', barFrom: '#be123c', barTo: '#e11d48' },
}

const UNKNOWN_THEME: ZoneColorTheme = {
  key: 'unknown',
  accent: '#64748b',
  accentHover: '#475569',
  soft: '#f8fafc',
  border: '#cbd5e1',
  barFrom: '#64748b',
  barTo: '#94a3b8',
}

const OTHER_THEME: ZoneColorTheme = {
  key: 'other',
  accent: '#94a3b8',
  accentHover: '#64748b',
  soft: '#f1f5f9',
  border: '#e2e8f0',
  barFrom: '#94a3b8',
  barTo: '#cbd5e1',
}

function zoneLetter(zone: string): string {
  const label = zone.replace(/区$/, '').replace(/^Zone\s/i, '').trim()
  const match = label.match(/[A-Za-z]/)
  return match ? match[0].toUpperCase() : ''
}

export function getZoneColorTheme(zone: string): ZoneColorTheme {
  const unknown = String(i18n.t('cancelScan.zoneUnknown', { ns: 'scannerEfficiency' }))
  const other = String(i18n.t('cancelScan.zoneOther', { ns: 'scannerEfficiency' }))
  if (zone === unknown) return UNKNOWN_THEME
  if (zone === other) return OTHER_THEME
  const letter = zoneLetter(zone)
  if (letter && LETTER_THEMES[letter]) return LETTER_THEMES[letter]
  return UNKNOWN_THEME
}

export function zoneThemeStyle(theme: ZoneColorTheme): Record<string, string> {
  return {
    '--zone-accent': theme.accent,
    '--zone-accent-hover': theme.accentHover,
    '--zone-soft': theme.soft,
    '--zone-border': theme.border,
    '--zone-bar-from': theme.barFrom,
    '--zone-bar-to': theme.barTo,
  }
}
