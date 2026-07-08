import type { PostFilterConfig } from './types'

export const DEFAULT_POST_FILTER_CONFIG: PostFilterConfig = {
  amountFilter: { currency: 'aud', minValue: null, maxValue: null },
  weightFilter: { minKg: null, maxKg: null },
  merchantFilter: { merchantCodes: [], merchantNameKeyword: '' },
  timeoutFilter: { minDays: null, maxDays: null },
}

/** 兼容旧版带 enabled 字段的持久化配置 */
export function normalizePostFilterConfig(raw: unknown): PostFilterConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_POST_FILTER_CONFIG
  }
  const c = raw as Record<string, unknown>
  const amount = (c.amountFilter ?? {}) as Record<string, unknown>
  const weight = (c.weightFilter ?? {}) as Record<string, unknown>
  const merchant = (c.merchantFilter ?? {}) as Record<string, unknown>
  const timeout = (c.timeoutFilter ?? {}) as Record<string, unknown>

  return {
    amountFilter: {
      currency: amount.currency === 'usd' ? 'usd' : 'aud',
      minValue: typeof amount.minValue === 'number' ? amount.minValue : null,
      maxValue: typeof amount.maxValue === 'number' ? amount.maxValue : null,
    },
    weightFilter: {
      minKg: typeof weight.minKg === 'number' ? weight.minKg : null,
      maxKg: typeof weight.maxKg === 'number' ? weight.maxKg : null,
    },
    merchantFilter: {
      merchantCodes: Array.isArray(merchant.merchantCodes)
        ? merchant.merchantCodes.filter((v): v is string => typeof v === 'string')
        : [],
      merchantNameKeyword:
        typeof merchant.merchantNameKeyword === 'string' ? merchant.merchantNameKeyword : '',
    },
    timeoutFilter: {
      minDays: typeof timeout.minDays === 'number' ? timeout.minDays : null,
      maxDays: typeof timeout.maxDays === 'number' ? timeout.maxDays : null,
    },
  }
}

export function isAmountFilterActive(config: PostFilterConfig): boolean {
  const { minValue, maxValue } = config.amountFilter
  return minValue != null || maxValue != null
}

export function isWeightFilterActive(config: PostFilterConfig): boolean {
  const { minKg, maxKg } = config.weightFilter
  return minKg != null || maxKg != null
}

export function isMerchantFilterActive(config: PostFilterConfig): boolean {
  const { merchantCodes, merchantNameKeyword } = config.merchantFilter
  return merchantCodes.length > 0 || merchantNameKeyword.trim() !== ''
}

export function isTimeoutFilterActive(config: PostFilterConfig): boolean {
  const { minDays, maxDays } = config.timeoutFilter
  return minDays != null || maxDays != null
}

export function countActivePostFilters(config: PostFilterConfig): number {
  return [
    isAmountFilterActive(config),
    isWeightFilterActive(config),
    isMerchantFilterActive(config),
    isTimeoutFilterActive(config),
  ].filter(Boolean).length
}
