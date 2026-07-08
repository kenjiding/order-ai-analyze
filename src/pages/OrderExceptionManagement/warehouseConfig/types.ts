export type WarehouseCityId = 'ADL' | 'MEL' | 'PER' | 'SYD' | 'BNE' | 'QLD' | 'CBR'

export const WAREHOUSE_CITY_OPTIONS: { value: WarehouseCityId; label: string }[] = [
  { value: 'ADL', label: 'ADL' },
  { value: 'MEL', label: 'MEL' },
  { value: 'PER', label: 'PER' },
  { value: 'SYD', label: 'SYD' },
  { value: 'BNE', label: 'BNE' },
  { value: 'QLD', label: 'QLD' },
  { value: 'CBR', label: 'CBR' },
]

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
  /** 与轨迹【】内仓库名一致 */
  name: string
  /** 轨迹中可能出现的其他写法，可选 */
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
