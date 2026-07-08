export type PostFilterAmountFilter = {
  currency: 'aud' | 'usd'
  minValue: number | null
  maxValue: number | null
}

export type PostFilterWeightFilter = {
  minKg: number | null
  maxKg: number | null
}

export type PostFilterMerchantFilter = {
  merchantCodes: string[]
  merchantNameKeyword: string
}

export type PostFilterTimeoutFilter = {
  minDays: number | null
  maxDays: number | null
}

export type PostFilterConfig = {
  amountFilter: PostFilterAmountFilter
  weightFilter: PostFilterWeightFilter
  merchantFilter: PostFilterMerchantFilter
  timeoutFilter: PostFilterTimeoutFilter
}
