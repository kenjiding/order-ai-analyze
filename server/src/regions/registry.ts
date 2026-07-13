export type RegionDefinition = {
  code: string
  name: string
  nameEn: string
  sortOrder: number
}

/** 超级管理员登录时选择的区域码（不对应真实州） */
export const SYSTEM_REGION_CODE = 'system'

export const AU_REGIONS: RegionDefinition[] = [
  { code: 'NSW', name: '新南威尔士州', nameEn: 'New South Wales', sortOrder: 10 },
  { code: 'VIC', name: '维多利亚州', nameEn: 'Victoria', sortOrder: 20 },
  { code: 'QLD', name: '昆士兰州', nameEn: 'Queensland', sortOrder: 30 },
  { code: 'SA', name: '南澳大利亚州', nameEn: 'South Australia', sortOrder: 40 },
  { code: 'WA', name: '西澳大利亚州', nameEn: 'Western Australia', sortOrder: 50 },
  { code: 'TAS', name: '塔斯马尼亚州', nameEn: 'Tasmania', sortOrder: 60 },
  { code: 'ACT', name: '首都领地', nameEn: 'Australian Capital Territory', sortOrder: 70 },
  { code: 'NT', name: '北领地', nameEn: 'Northern Territory', sortOrder: 80 },
  { code: 'NZ', name: '新西兰', nameEn: 'New Zealand', sortOrder: 90 },
]

export const SYSTEM_REGION: RegionDefinition = {
  code: SYSTEM_REGION_CODE,
  name: '系统管理',
  nameEn: 'System Admin',
  sortOrder: 0,
}

export const USER_ASSIGNABLE_REGIONS: RegionDefinition[] = AU_REGIONS

export function getRegionLabel(code: string | null | undefined): string {
  if (!code) return '—'
  if (code === SYSTEM_REGION_CODE) return SYSTEM_REGION.name
  return AU_REGIONS.find((r) => r.code === code)?.name ?? code
}

export function isAssignableRegionCode(code: string): boolean {
  return AU_REGIONS.some((r) => r.code === code)
}

export function normalizeUsername(raw: string): string {
  return raw.trim()
}

export function isValidUsername(raw: string): boolean {
  const value = normalizeUsername(raw)
  if (value.length < 2 || value.length > 64) return false
  return /^[\w.-]+$/.test(value)
}
