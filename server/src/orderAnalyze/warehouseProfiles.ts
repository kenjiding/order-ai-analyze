import type { OperatorClassification, RealOperatorPattern, WarehouseProfile } from './types'

const COMMON_SYSTEM_OPERATORS = ['System', 'cornerstone'] as const

const COMMON_NON_REAL_OPERATORS = ['ADL-DC-Unload', 'Kuangyi Gao', 'Leeki'] as const

export const DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS = 15

/** 外部承运（3PL）交接后多久仍未完结即判「3PL丢件」；默认与公司仓库库内/库外丢失超时阈值一致 */
export const EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS = DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS

function normalizeText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

function operatorNameEquals(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function matchesRealOperatorPattern(name: string, pattern: RealOperatorPattern): boolean {
  if (typeof pattern === 'string') return operatorNameEquals(name, pattern)
  return pattern.test(name)
}

export const WAREHOUSE_PROFILES: readonly WarehouseProfile[] = [
  {
    cityId: 'ADL',
    hubId: 'adelaide_center',
    displayName: 'Adelaide Center',
    aliases: ['Adelaide Center', 'adeliade center', 'Adelaide Centre', 'ADL Center', 'ADL Centre'],
    realOperatorPatterns: [/^ADL-(?!DC-Unload\b|OP1\b).+/i, /^ADL-DC-(?!Unload\b).+/i],
    nonRealOperators: COMMON_NON_REAL_OPERATORS,
    systemOperators: [...COMMON_SYSTEM_OPERATORS, 'ADL OP1'],
  },
  {
    cityId: 'ADL',
    hubId: 'adelaide_ds',
    displayName: 'Adelaide DS',
    aliases: ['Adelaide DS', 'adelaide DS', 'ADL DS'],
    realOperatorPatterns: [/^ADL-(?!DC-Unload\b|OP1\b).+/i, /^ADL-DC-(?!Unload\b).+/i],
    nonRealOperators: COMMON_NON_REAL_OPERATORS,
    systemOperators: [...COMMON_SYSTEM_OPERATORS, 'ADL OP1'],
  },
  {
    cityId: 'MEL',
    hubId: 'melbourne_center',
    displayName: 'Melbourne Center',
    aliases: ['Melbourne Center', 'Melbourne Centre', 'MEL Center', 'MEL Centre'],
    realOperatorPatterns: [/^MEL[_-].+/i, /^Mel[_-].+/, /^(MEL_RDC_Scanner_)\d+$/i, /Mel_FrontDesk_\d+$/i],
    systemOperators: COMMON_SYSTEM_OPERATORS,
  },
  {
    cityId: 'MEL',
    hubId: 'Mel South East',
    displayName: 'Mel South East',
    aliases: ['Mel South East', 'MEL DS'],
    realOperatorPatterns: [/^MEL[_-].+/i, /^Mel[_-].+/],
    systemOperators: COMMON_SYSTEM_OPERATORS,
  },
  {
    cityId: 'QLD',
    hubId: 'Townsville Station',
    displayName: 'Queensland',
    aliases: ['Townsville Station'],
    realOperatorPatterns: ['OPENCLAW-RAY'],
    systemOperators: [...COMMON_SYSTEM_OPERATORS, 'Townsville Station'],
  },
  {
    cityId: 'CBR',
    hubId: 'canberra_station',
    displayName: 'Canberra Station',
    aliases: ['Canberra Station', 'Canberra station'],
    realOperatorPatterns: [/^CBR Warehouse\d+$/i],
    systemOperators: COMMON_SYSTEM_OPERATORS,
  },
  {
    cityId: 'PER',
    hubId: 'perth_placeholder',
    displayName: 'Perth',
    aliases: ['Perth Center', 'Perth Centre', 'Perth DS', 'PER Center', 'PER DS'],
    realOperatorPatterns: [/^PER[_-].+/i, /PER Warehouse\d+$/i],
    nonRealOperators: ['PER OPS1', 'PER OPS2', 'PER OPS3', 'PER OPS4', 'PER OPS5', 'PER OPS6', 'PER OPS7', 'PER OPS8', 'PER OPS9', 'PER OPS10'],
    systemOperators: COMMON_SYSTEM_OPERATORS,
  },
  {
    cityId: 'SYD',
    hubId: 'sydney_placeholder',
    displayName: 'Sydney',
    aliases: ['Sydney Center', 'Sydney Centre', 'Sydney DS', 'SYD Center', 'SYD DS'],
    realOperatorPatterns: [/^SYD[_-].+/i, /^SYD Warehouse\d+$/i, /^NSYD W\d+$/i],
    systemOperators: COMMON_SYSTEM_OPERATORS,
  },
  {
    cityId: 'SYD',
    hubId: 'SYDN',
    displayName: 'SYDN',
    aliases: ['SYDN'],
    realOperatorPatterns: [/^SYD[_-].+/i, /^SYD Warehouse\d+$/i, /^NSYD W\d+$/i],
    nonRealOperators: ['SYDN OPS1', 'SYDN OPS2', 'SYDN OPS3', 'SYDN OPS4', 'SYDN OPS5', 'SYDN OPS6', 'SYDN OPS7', 'SYDN OPS8', 'SYDN OPS9', 'SYDN OPS10'],
    systemOperators: COMMON_SYSTEM_OPERATORS,
  },
  {
    cityId: 'SYD',
    hubId: 'SYDE',
    displayName: 'SYDE',
    aliases: ['SYDE', 'Sydney East', 'Sydney East DS', 'SYDE DS'],
    realOperatorPatterns: [/^SYD[_-].+/i, /^SYD Warehouse\d+$/i, /^NSYD W\d+$/i, /SYDE-PUS \d+$/i, /SYDE OPS\d+$/i],
    nonRealOperators: ['SYDE OPS1', 'SYDE OPS2', 'SYDE OPS3', 'SYDE OPS4', 'SYDE OPS5', 'SYDE OPS6', 'SYDE OPS7', 'SYDE OPS8', 'SYDE OPS9', 'SYDE OPS10'],
    systemOperators: COMMON_SYSTEM_OPERATORS,
  },
  {
    cityId: 'SYD',
    hubId: 'syd_csp_7',
    displayName: 'SYD CSP 7',
    aliases: ['SYD CSP 7'],
    realOperatorPatterns: [/JCL warehouse\d+$/i],
    systemOperators: COMMON_SYSTEM_OPERATORS,
  },
  {
    cityId: 'BNE',
    hubId: 'brisbane_placeholder',
    displayName: 'Brisbane',
    aliases: ['Brisbane Center', 'Brisbane Centre', 'Brisbane DS', 'BNE Center', 'BNE DS'],
    realOperatorPatterns: [/^BNE[_-].+/i, 'BNE Warehouse14', 'BNE Warehouse5'],
    systemOperators: COMMON_SYSTEM_OPERATORS,
  },
] as const

export function findWarehouseProfileByName(raw: string): WarehouseProfile | null {
  const normalized = normalizeText(raw)
  if (!normalized) return null
  return (
    WAREHOUSE_PROFILES.find((profile) => {
      return profile.aliases.some((alias) => {
        const normalizedAlias = normalizeText(alias)
        return normalized === normalizedAlias || normalized.includes(normalizedAlias)
      })
    }) ?? null
  )
}

export function classifyOperatorForWarehouse(
  operatorName: string,
  profile: WarehouseProfile | null
): OperatorClassification {
  const name = operatorName.trim()
  if (!name) return 'unknown'

  const systemOperators = profile?.systemOperators ?? COMMON_SYSTEM_OPERATORS
  if (systemOperators.some((operator) => operatorNameEquals(operator, name))) return 'system'

  const nonRealOperators = profile?.nonRealOperators ?? COMMON_NON_REAL_OPERATORS
  if (nonRealOperators.some((operator) => operatorNameEquals(operator, name))) return 'non_real'

  if (profile?.nonRealOperatorPatterns?.some((pattern) => pattern.test(name))) return 'non_real'
  if (profile?.realOperatorPatterns.some((pattern) => matchesRealOperatorPattern(name, pattern))) return 'real'

  return profile ? 'unknown' : 'unknown'
}

export function getWarehouseLossTimeoutDays(profile: WarehouseProfile | null): number {
  const configured = profile?.lossTimeoutDays
  if (!Number.isFinite(configured) || configured === undefined) return DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS
  return Math.max(1, Math.floor(configured))
}

function formatPattern(pattern: RegExp): string {
  return pattern.toString()
}

function formatRealOperatorPattern(pattern: RealOperatorPattern): string {
  return typeof pattern === 'string' ? `"${pattern}"` : formatPattern(pattern)
}

export function buildWarehouseProfilePromptLines(): string[] {
  return WAREHOUSE_PROFILES.map((profile) => {
    const aliases = profile.aliases.join(' / ')
    const realPatterns = profile.realOperatorPatterns.map(formatRealOperatorPattern).join('、') || '无'
    const nonRealOperators = profile.nonRealOperators?.join('、') || '无'
    const nonRealPatterns = profile.nonRealOperatorPatterns?.map(formatPattern).join('、') || '无'
    const systemOperators = profile.systemOperators?.join('、') || COMMON_SYSTEM_OPERATORS.join('、')
    return `  · ${profile.cityId}/${profile.hubId}（${aliases}）：真实扫描员规则=${realPatterns}；非真实账号=${nonRealOperators}；非真实规则=${nonRealPatterns}；系统账号=${systemOperators}`
  })
}

export function getConfiguredSystemOperatorNames(): string[] {
  const names = new Set<string>(COMMON_SYSTEM_OPERATORS)
  for (const profile of WAREHOUSE_PROFILES) {
    for (const name of profile.systemOperators ?? []) names.add(name)
  }
  return Array.from(names)
}

export function getConfiguredNonRealOperatorNames(): string[] {
  const names = new Set<string>(COMMON_NON_REAL_OPERATORS)
  for (const profile of WAREHOUSE_PROFILES) {
    for (const name of profile.nonRealOperators ?? []) names.add(name)
  }
  return Array.from(names)
}

export function isConfiguredNonRealOrSystemOperator(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return false
  return [...getConfiguredSystemOperatorNames(), ...getConfiguredNonRealOperatorNames()].some(
    (operator) => operator.trim().toLowerCase() === normalized
  )
}
