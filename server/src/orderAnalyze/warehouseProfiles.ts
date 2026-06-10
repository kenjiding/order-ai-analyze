import type { OperatorClassification, WarehouseProfile } from './types'

const COMMON_SYSTEM_OPERATORS = ['System', 'cornerstone'] as const

const COMMON_NON_REAL_OPERATORS = ['ADL-DC-Unload', 'Kuangyi Gao', 'Leeki', 'sorter', 'ADL OP1'] as const

export const DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS = 15

/** 外部承运（3PL）交接后多久仍未完结即判「3PL丢件」；默认与公司仓库库内/库外丢失超时阈值一致 */
export const EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS = DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS

function normalizeText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

function operatorNameEquals(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export const WAREHOUSE_PROFILES: readonly WarehouseProfile[] = [
  {
    cityId: 'ADL',
    hubId: 'adelaide_center',
    displayName: 'Adelaide Center',
    aliases: ['Adelaide Center', 'adeliade center', 'Adelaide Centre', 'ADL Center', 'ADL Centre'],
    nonRealOperators: COMMON_NON_REAL_OPERATORS,
    systemOperators: ['ADL OP1'],
  },
  {
    cityId: 'ADL',
    hubId: 'adelaide_ds',
    displayName: 'Adelaide DS',
    aliases: ['Adelaide DS', 'adelaide DS', 'ADL DS'],
    nonRealOperators: COMMON_NON_REAL_OPERATORS,
    systemOperators: ['ADL OP1'],
  },
  {
    cityId: 'MEL',
    hubId: 'melbourne_center',
    displayName: 'Melbourne Center',
    aliases: ['Melbourne Center', 'Melbourne Centre', 'MEL Center', 'MEL Centre'],
  },
  {
    cityId: 'MEL',
    hubId: 'Mel South East',
    displayName: 'Mel South East',
    aliases: ['Mel South East', 'MEL DS'],
  },
  {
    cityId: 'QLD',
    hubId: 'Townsville Station',
    displayName: 'Queensland',
    aliases: ['Townsville Station'],
    systemOperators: ['Townsville Station'],
  },
  {
    cityId: 'CBR',
    hubId: 'canberra_station',
    displayName: 'Canberra Station',
    aliases: ['Canberra Station', 'Canberra station'],
  },
  {
    cityId: 'QLD',
    hubId: 'gold_coast_station',
    displayName: 'Gold Coast Station',
    aliases: ['Gold Coast Station', 'Gold Coast station'],
  },
  {
    cityId: 'QLD',
    hubId: 'sunshine_coast_station',
    displayName: 'Sunshine Coast Station',
    aliases: ['Sunshine Coast Station', 'Sunshine Coast station'],
  },
  {
    cityId: 'SYD',
    hubId: 'newcastle_2',
    displayName: 'Newcastle-2',
    aliases: ['Newcastle-2', 'Newcastle 2', 'Newcasle-2'],
  },
  {
    cityId: 'PER',
    hubId: 'perth_placeholder',
    displayName: 'Perth',
    aliases: ['Perth Center', 'Perth Centre', 'Perth DS', 'PER Center', 'PER DS'],
    nonRealOperators: ['PER OPS1', 'PER OPS2', 'PER OPS3', 'PER OPS4', 'PER OPS5', 'PER OPS6', 'PER OPS7', 'PER OPS8', 'PER OPS9', 'PER OPS10'],
  },
  {
    cityId: 'SYD',
    hubId: 'sydney_placeholder',
    displayName: 'Sydney',
    aliases: ['Sydney Center', 'Sydney Centre', 'Sydney DS', 'SYD Center', 'SYD DS'],
  },
  {
    cityId: 'SYD',
    hubId: 'SYDN',
    displayName: 'SYDN',
    aliases: ['SYDN'],
    nonRealOperators: ['SYDN OPS1', 'SYDN OPS2', 'SYDN OPS3', 'SYDN OPS4', 'SYDN OPS5', 'SYDN OPS6', 'SYDN OPS7', 'SYDN OPS8', 'SYDN OPS9', 'SYDN OPS10'],
    lossTimeoutDays: 7,
  },
  {
    cityId: 'SYD',
    hubId: 'SYDE',
    displayName: 'SYDE',
    aliases: ['SYDE', 'Sydney East', 'Sydney East DS', 'SYDE DS'],
    nonRealOperators: ['SYDE OPS1', 'SYDE OPS2', 'SYDE OPS3', 'SYDE OPS4', 'SYDE OPS5', 'SYDE OPS6', 'SYDE OPS7', 'SYDE OPS8', 'SYDE OPS9', 'SYDE OPS10'],
    lossTimeoutDays: 30,
  },
  {
    cityId: 'SYD',
    hubId: 'syd_csp_7',
    displayName: 'SYD CSP 7',
    aliases: ['SYD CSP 7'],
  },
  {
    cityId: 'BNE',
    hubId: 'brisbane_placeholder',
    displayName: 'Brisbane',
    aliases: ['Brisbane Center', 'Brisbane Centre', 'Brisbane DS', 'BNE Center', 'BNE DS'],
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

  const systemOperators = [...COMMON_SYSTEM_OPERATORS, ...(profile?.systemOperators ?? [])]
  if (systemOperators.some((operator) => operatorNameEquals(operator, name))) return 'system'

  const nonRealOperators = [...COMMON_NON_REAL_OPERATORS, ...(profile?.nonRealOperators ?? [])]
  if (nonRealOperators.some((operator) => operatorNameEquals(operator, name))) return 'non_real'

  if (profile?.nonRealOperatorPatterns?.some((pattern) => pattern.test(name))) return 'non_real'

  return profile ? 'real' : 'unknown'
}

export function getWarehouseLossTimeoutDays(profile: WarehouseProfile | null): number {
  const configured = profile?.lossTimeoutDays
  if (!Number.isFinite(configured) || configured === undefined) return DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS
  return Math.max(1, Math.floor(configured))
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
