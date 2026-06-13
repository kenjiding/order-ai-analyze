/** 与 server/src/imile/portal.ts IMILE_DC_SCAN_QUERY_PORTAL 默认值对齐 */
export type ImilePortalSettings = {
  hubcode: string
  resourceCode: string
  userCode: string
}

export const DEFAULT_IMILE_PORTAL_SETTINGS: ImilePortalSettings = {
  hubcode: 'S210372901',
  resourceCode: 'ScanQuery',
  userCode: '',
}

export const IMILE_PORTAL_STORAGE_KEY = 'app_imile_portal_v1'

export function normalizeImilePortalSettings(raw: Partial<ImilePortalSettings> | null | undefined): ImilePortalSettings {
  return {
    hubcode: String(raw?.hubcode ?? DEFAULT_IMILE_PORTAL_SETTINGS.hubcode).trim() || DEFAULT_IMILE_PORTAL_SETTINGS.hubcode,
    resourceCode:
      String(raw?.resourceCode ?? DEFAULT_IMILE_PORTAL_SETTINGS.resourceCode).trim() ||
      DEFAULT_IMILE_PORTAL_SETTINGS.resourceCode,
    userCode: String(raw?.userCode ?? '').trim(),
  }
}

export function readStoredImilePortalSettings(): ImilePortalSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_IMILE_PORTAL_SETTINGS }
  try {
    const raw = localStorage.getItem(IMILE_PORTAL_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_IMILE_PORTAL_SETTINGS }
    return normalizeImilePortalSettings(JSON.parse(raw) as Partial<ImilePortalSettings>)
  } catch {
    return { ...DEFAULT_IMILE_PORTAL_SETTINGS }
  }
}

export function toImilePortalOverrides(settings: ImilePortalSettings) {
  const normalized = normalizeImilePortalSettings(settings)
  return {
    hubcode: normalized.hubcode,
    resourceCode: normalized.resourceCode,
    userCode: normalized.userCode || undefined,
  }
}
