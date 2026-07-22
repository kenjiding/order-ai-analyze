import type { OperatorClassification, WarehouseCityId, WarehouseProfile } from './types'

export type WarehouseConfigGlobalDto = {
  defaultLossTimeoutDays: number
  externalCarrierLossTimeoutDays: number
  commonSystemOperators: string[]
  commonNonRealOperators: string[]
  commonNonRealOperatorPatterns: string[]
}

export type WarehouseProfileDto = {
  cityId: WarehouseCityId
  hubId: string
  name: string
  extraAliases?: string[]
  lossTimeoutDays?: number
  nonRealOperators?: string[]
  nonRealOperatorPatterns?: string[]
  systemOperators?: string[]
}

export type WarehouseConfigDto = {
  global: WarehouseConfigGlobalDto
  profiles: WarehouseProfileDto[]
}

export type WarehouseProfileContext = {
  profiles: readonly WarehouseProfile[]
  defaultLossTimeoutDays: number
  externalCarrierLossTimeoutDays: number
  findWarehouseProfileByName(raw: string): WarehouseProfile | null
  classifyOperatorForWarehouse(
    operatorName: string,
    profile: WarehouseProfile | null
  ): OperatorClassification
  getWarehouseLossTimeoutDays(profile: WarehouseProfile | null): number
  getConfiguredSystemOperatorNames(): string[]
  getConfiguredNonRealOperatorNames(): string[]
  isConfiguredNonRealOrSystemOperator(name: string): boolean
  /**
   * 账号是否匹配「共享工位」正则（如 nonRealOperatorPatterns 里的 `^[A-Z]{2,5}\s+OPS\d+$`，
   * 命中 `SYDE OPS1` 这类名字）：多名员工共用同一登录账号，无法定位到具体个人，
   * 但账号本身不是系统/设备自动事件，只按正则判定，不看逐条枚举的 nonRealOperators
   * （部分仓库把同一批 OPS 账号又重复写进了精确名单，那不代表要排除它们）。
   * 真正需要排除的已知不可信账号（sorter、System 等）本身不匹配该正则，不受影响，
   * 它们即便携带「已到达」也不代表包裹真实到仓，因此不适用本判定。
   */
  isSharedWorkstationOperator(operatorName: string, profile: WarehouseProfile | null): boolean
}

const WAREHOUSE_CITY_IDS: readonly WarehouseCityId[] = [
  'ADL',
  'MEL',
  'PER',
  'SYD',
  'BNE',
  'QLD',
  'CBR',
]

function normalizeText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

function warehouseTrackNames(profile: Pick<WarehouseProfile, 'name' | 'extraAliases'>): string[] {
  return [profile.name, ...(profile.extraAliases ?? [])]
}

function matchesWarehouseTrackName(
  profile: Pick<WarehouseProfile, 'name' | 'extraAliases'>,
  raw: string
): boolean {
  const normalized = normalizeText(raw)
  if (!normalized) return false
  return warehouseTrackNames(profile).some((candidate) => {
    const normalizedCandidate = normalizeText(candidate)
    return normalized === normalizedCandidate || normalized.includes(normalizedCandidate)
  })
}

function operatorNameEquals(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function compilePatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = []
  for (const raw of patterns) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    try {
      compiled.push(new RegExp(trimmed))
    } catch {
      /* skip invalid pattern */
    }
  }
  return compiled
}

function toRuntimeProfile(dto: WarehouseProfileDto): WarehouseProfile {
  const profile: WarehouseProfile = {
    cityId: dto.cityId,
    hubId: dto.hubId.trim(),
    name: dto.name.trim(),
  }
  const extraAliases = sanitizeStringList(dto.extraAliases).filter(
    (alias) => normalizeText(alias) !== normalizeText(dto.name)
  )
  if (extraAliases.length) profile.extraAliases = extraAliases
  if (dto.lossTimeoutDays !== undefined) profile.lossTimeoutDays = dto.lossTimeoutDays
  if (dto.nonRealOperators?.length) profile.nonRealOperators = [...dto.nonRealOperators]
  if (dto.systemOperators?.length) profile.systemOperators = [...dto.systemOperators]
  const patterns = compilePatterns(dto.nonRealOperatorPatterns ?? [])
  if (patterns.length) profile.nonRealOperatorPatterns = patterns
  return profile
}

function sanitizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => String(item).trim()).filter(Boolean)
}

function sanitizeGlobal(raw: unknown, fallback: WarehouseConfigGlobalDto): WarehouseConfigGlobalDto {
  if (!raw || typeof raw !== 'object') return fallback
  const input = raw as Partial<WarehouseConfigGlobalDto>
  const defaultLossTimeoutDays = Number(input.defaultLossTimeoutDays)
  const externalCarrierLossTimeoutDays = Number(input.externalCarrierLossTimeoutDays)
  return {
    defaultLossTimeoutDays:
      Number.isFinite(defaultLossTimeoutDays) && defaultLossTimeoutDays >= 1
        ? Math.floor(defaultLossTimeoutDays)
        : fallback.defaultLossTimeoutDays,
    externalCarrierLossTimeoutDays:
      Number.isFinite(externalCarrierLossTimeoutDays) && externalCarrierLossTimeoutDays >= 1
        ? Math.floor(externalCarrierLossTimeoutDays)
        : fallback.externalCarrierLossTimeoutDays,
    commonSystemOperators: sanitizeStringList(input.commonSystemOperators).length
      ? sanitizeStringList(input.commonSystemOperators)
      : [...fallback.commonSystemOperators],
    commonNonRealOperators: sanitizeStringList(input.commonNonRealOperators).length
      ? sanitizeStringList(input.commonNonRealOperators)
      : [...fallback.commonNonRealOperators],
    commonNonRealOperatorPatterns: sanitizeStringList(input.commonNonRealOperatorPatterns).length
      ? sanitizeStringList(input.commonNonRealOperatorPatterns)
      : [...fallback.commonNonRealOperatorPatterns],
  }
}

function sanitizeProfile(raw: unknown): WarehouseProfileDto | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Partial<WarehouseProfileDto>
  const cityId = String(input.cityId ?? '').trim() as WarehouseCityId
  if (!WAREHOUSE_CITY_IDS.includes(cityId)) return null
  const hubId = String(input.hubId ?? '').trim()
  const name = String(input.name ?? '').trim()
  if (!hubId || !name) return null

  const profile: WarehouseProfileDto = { cityId, hubId, name }
  const extraAliases = sanitizeStringList(input.extraAliases).filter(
    (alias) => normalizeText(alias) !== normalizeText(name)
  )
  if (extraAliases.length) profile.extraAliases = extraAliases
  const lossTimeoutDays = Number(input.lossTimeoutDays)
  if (Number.isFinite(lossTimeoutDays) && lossTimeoutDays >= 1) {
    profile.lossTimeoutDays = Math.floor(lossTimeoutDays)
  }
  const nonRealOperators = sanitizeStringList(input.nonRealOperators)
  if (nonRealOperators.length) profile.nonRealOperators = nonRealOperators
  const systemOperators = sanitizeStringList(input.systemOperators)
  if (systemOperators.length) profile.systemOperators = systemOperators
  const nonRealOperatorPatterns = sanitizeStringList(input.nonRealOperatorPatterns)
  if (nonRealOperatorPatterns.length) profile.nonRealOperatorPatterns = nonRealOperatorPatterns
  return profile
}

export const DEFAULT_WAREHOUSE_CONFIG: WarehouseConfigDto = {
  global: {
    defaultLossTimeoutDays: 15,
    externalCarrierLossTimeoutDays: 15,
    commonSystemOperators: ['System', 'cornerstone'],
    commonNonRealOperators: ['ADL-DC-Unload', 'Kuangyi Gao', 'Leeki', 'sorter', 'ADL OP1'],
    commonNonRealOperatorPatterns: ['^[A-Z]{2,5}\\s+OPS\\d+$'],
  },
  profiles: [
    {
      cityId: 'ADL',
      hubId: 'adelaide_center',
      name: 'Adelaide Center',
      extraAliases: ['adeliade center', 'Adelaide Centre', 'ADL Center', 'ADL Centre'],
      nonRealOperators: ['ADL-DC-Unload', 'Kuangyi Gao', 'Leeki', 'sorter', 'ADL OP1'],
      systemOperators: ['ADL OP1'],
    },
    {
      cityId: 'ADL',
      hubId: 'adelaide_ds',
      name: 'Adelaide DS',
      extraAliases: ['adelaide DS', 'ADL DS'],
      nonRealOperators: ['ADL-DC-Unload', 'Kuangyi Gao', 'Leeki', 'sorter', 'ADL OP1'],
      systemOperators: ['ADL OP1'],
    },
    {
      cityId: 'MEL',
      hubId: 'melbourne_center',
      name: 'Melbourne Center',
      extraAliases: ['Melbourne Centre', 'MEL Center', 'MEL Centre'],
    },
    {
      cityId: 'MEL',
      hubId: 'Mel South East',
      name: 'Mel South East',
      extraAliases: ['MEL DS'],
    },
    {
      cityId: 'QLD',
      hubId: 'Townsville Station',
      name: 'Townsville Station',
      systemOperators: ['Townsville Station'],
    },
    {
      cityId: 'CBR',
      hubId: 'canberra_station',
      name: 'Canberra Station',
      extraAliases: ['Canberra station'],
    },
    {
      cityId: 'QLD',
      hubId: 'gold_coast_station',
      name: 'Gold Coast Station',
      extraAliases: ['Gold Coast station'],
    },
    {
      cityId: 'QLD',
      hubId: 'sunshine_coast_station',
      name: 'Sunshine Coast Station',
      extraAliases: ['Sunshine Coast station'],
    },
    {
      cityId: 'SYD',
      hubId: 'newcastle_2',
      name: 'Newcastle-2',
      extraAliases: ['Newcastle 2', 'Newcasle-2'],
    },
    {
      cityId: 'PER',
      hubId: 'perth_placeholder',
      name: 'Perth Center',
      extraAliases: ['Perth Centre', 'Perth DS', 'PER Center', 'PER DS', 'Perth'],
      nonRealOperators: [
        'PER OPS1',
        'PER OPS2',
        'PER OPS3',
        'PER OPS4',
        'PER OPS5',
        'PER OPS6',
        'PER OPS7',
        'PER OPS8',
        'PER OPS9',
        'PER OPS10',
      ],
    },
    {
      cityId: 'SYD',
      hubId: 'sydney_placeholder',
      name: 'Sydney Center',
      extraAliases: ['Sydney Centre', 'Sydney DS', 'SYD Center', 'SYD DS', 'Sydney'],
    },
    {
      cityId: 'SYD',
      hubId: 'SYDN',
      name: 'SYDN',
      nonRealOperators: [
        'SYDN OPS1',
        'SYDN OPS2',
        'SYDN OPS3',
        'SYDN OPS4',
        'SYDN OPS5',
        'SYDN OPS6',
        'SYDN OPS7',
        'SYDN OPS8',
        'SYDN OPS9',
        'SYDN OPS10',
      ],
      lossTimeoutDays: 7,
    },
    {
      cityId: 'SYD',
      hubId: 'SYDE',
      name: 'SYDE',
      extraAliases: ['Sydney East', 'Sydney East DS', 'SYDE DS'],
      nonRealOperators: [
        'SYDE OPS1',
        'SYDE OPS2',
        'SYDE OPS3',
        'SYDE OPS4',
        'SYDE OPS5',
        'SYDE OPS6',
        'SYDE OPS7',
        'SYDE OPS8',
        'SYDE OPS9',
        'SYDE OPS10',
      ],
      lossTimeoutDays: 30,
    },
    {
      cityId: 'SYD',
      hubId: 'syd_csp_7',
      name: 'SYD CSP 7',
    },
    {
      cityId: 'BNE',
      hubId: 'brisbane_placeholder',
      name: 'Brisbane Center',
      extraAliases: ['Brisbane Centre', 'Brisbane DS', 'BNE Center', 'BNE DS', 'Brisbane'],
    },
  ],
}

export function parseWarehouseConfigInput(raw: unknown): WarehouseConfigDto | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') return null
  const input = raw as Partial<WarehouseConfigDto>
  const global = sanitizeGlobal(input.global, DEFAULT_WAREHOUSE_CONFIG.global)
  const profilesRaw = Array.isArray(input.profiles) ? input.profiles : null
  if (!profilesRaw?.length) return null
  const profiles = profilesRaw.map(sanitizeProfile).filter((profile): profile is WarehouseProfileDto => profile !== null)
  if (!profiles.length) return null
  return { global, profiles }
}

export function createWarehouseProfileContext(config: WarehouseConfigDto): WarehouseProfileContext {
  const global = sanitizeGlobal(config.global, DEFAULT_WAREHOUSE_CONFIG.global)
  const profiles = config.profiles.map(toRuntimeProfile)
  const commonSystemOperators = [...global.commonSystemOperators]
  const commonNonRealOperators = [...global.commonNonRealOperators]
  const commonNonRealOperatorPatterns = compilePatterns(global.commonNonRealOperatorPatterns)

  return {
    profiles,
    defaultLossTimeoutDays: global.defaultLossTimeoutDays,
    externalCarrierLossTimeoutDays: global.externalCarrierLossTimeoutDays,
    findWarehouseProfileByName(raw: string) {
      return profiles.find((profile) => matchesWarehouseTrackName(profile, raw)) ?? null
    },
    classifyOperatorForWarehouse(operatorName: string, profile: WarehouseProfile | null) {
      const name = operatorName.trim()
      if (!name) return 'unknown'

      const systemOperators = [...commonSystemOperators, ...(profile?.systemOperators ?? [])]
      if (systemOperators.some((operator) => operatorNameEquals(operator, name))) return 'system'

      const nonRealOperators = [...commonNonRealOperators, ...(profile?.nonRealOperators ?? [])]
      if (nonRealOperators.some((operator) => operatorNameEquals(operator, name))) return 'non_real'

      const nonRealOperatorPatterns = [
        ...commonNonRealOperatorPatterns,
        ...(profile?.nonRealOperatorPatterns ?? []),
      ]
      if (nonRealOperatorPatterns.some((pattern) => pattern.test(name))) return 'non_real'

      return profile ? 'real' : 'unknown'
    },
    isSharedWorkstationOperator(operatorName: string, profile: WarehouseProfile | null) {
      const name = operatorName.trim()
      if (!name) return false

      const systemOperators = [...commonSystemOperators, ...(profile?.systemOperators ?? [])]
      if (systemOperators.some((operator) => operatorNameEquals(operator, name))) return false

      // 仅按「共享工位」正则判定，不看逐条枚举的 nonRealOperators：
      // SYDE/SYDN/PER 等仓库把 `XXX OPSn` 既写进了精确名单也命中通用正则（历史遗留的重复配置），
      // 若在此处也排除精确名单命中，会把这些本该信任的共享工位账号误判掉；
      // 真正需要排除的具体黑名单账号（sorter、Kuangyi Gao 等）本身就不匹配该正则，不受影响。
      const nonRealOperatorPatterns = [
        ...commonNonRealOperatorPatterns,
        ...(profile?.nonRealOperatorPatterns ?? []),
      ]
      return nonRealOperatorPatterns.some((pattern) => pattern.test(name))
    },
    getWarehouseLossTimeoutDays(profile: WarehouseProfile | null) {
      const configured = profile?.lossTimeoutDays
      if (!Number.isFinite(configured) || configured === undefined) return global.defaultLossTimeoutDays
      return Math.max(1, Math.floor(configured))
    },
    getConfiguredSystemOperatorNames() {
      const names = new Set<string>(commonSystemOperators)
      for (const profile of profiles) {
        for (const name of profile.systemOperators ?? []) names.add(name)
      }
      return Array.from(names)
    },
    getConfiguredNonRealOperatorNames() {
      const names = new Set<string>(commonNonRealOperators)
      for (const profile of profiles) {
        for (const name of profile.nonRealOperators ?? []) names.add(name)
      }
      return Array.from(names)
    },
    isConfiguredNonRealOrSystemOperator(name: string) {
      const normalized = name.trim().toLowerCase()
      if (!normalized) return false
      const systemNames = new Set<string>(commonSystemOperators)
      const nonRealNames = new Set<string>(commonNonRealOperators)
      for (const profile of profiles) {
        for (const operator of profile.systemOperators ?? []) systemNames.add(operator)
        for (const operator of profile.nonRealOperators ?? []) nonRealNames.add(operator)
      }
      const matchesConfiguredName = [...systemNames, ...nonRealNames].some(
        (operator) => operator.trim().toLowerCase() === normalized
      )
      if (matchesConfiguredName) return true
      return profiles.some((profile) =>
        [...commonNonRealOperatorPatterns, ...(profile.nonRealOperatorPatterns ?? [])].some((pattern) =>
          pattern.test(name)
        )
      )
    },
  }
}

export const defaultWarehouseProfileContext = createWarehouseProfileContext(DEFAULT_WAREHOUSE_CONFIG)
