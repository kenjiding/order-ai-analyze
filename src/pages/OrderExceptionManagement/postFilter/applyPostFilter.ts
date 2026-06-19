import type { TrackEvent } from '../types'
import type { AnalysisRow } from '../useOrderExceptionManagementPage'
import {
  isAmountFilterActive,
  isMerchantFilterActive,
  isTimeoutFilterActive,
  isWeightFilterActive,
} from './defaults'
import type { PostFilterConfig } from './types'

export function calcLastEventDaysDiff(trackEvents: TrackEvent[]): number | null {
  if (!trackEvents.length) return null
  const lastMs = Math.max(...trackEvents.map((e) => new Date(e.time).getTime()))
  if (!Number.isFinite(lastMs)) return null
  return Math.floor((Date.now() - lastMs) / 86400000)
}

export function applyPostFilter(rows: AnalysisRow[], config: PostFilterConfig): AnalysisRow[] {
  const amountActive = isAmountFilterActive(config)
  const weightActive = isWeightFilterActive(config)
  const merchantActive = isMerchantFilterActive(config)
  const timeoutActive = isTimeoutFilterActive(config)

  if (!amountActive && !weightActive && !merchantActive && !timeoutActive) return rows

  const { amountFilter, weightFilter, merchantFilter, timeoutFilter } = config

  return rows.filter((row) => {
    if (row.status !== 'done') return true

    if (amountActive) {
      const raw =
        amountFilter.currency === 'aud'
          ? row.orderInfo?.customerDeclaredValueAud
          : row.orderInfo?.declaredValueUsd
      const amount = raw != null ? parseFloat(raw) : NaN
      if (!Number.isFinite(amount)) return false
      if (amountFilter.minValue != null && amount <= amountFilter.minValue) return false
      if (amountFilter.maxValue != null && amount >= amountFilter.maxValue) return false
    }

    if (weightActive) {
      const raw = row.orderInfo?.totalWeight
      const weight = raw != null ? parseFloat(raw) : NaN
      if (!Number.isFinite(weight)) return false
      if (weightFilter.minKg != null && weight <= weightFilter.minKg) return false
      if (weightFilter.maxKg != null && weight >= weightFilter.maxKg) return false
    }

    if (merchantActive) {
      const codes = merchantFilter.merchantCodes
      const keyword = merchantFilter.merchantNameKeyword.trim().toLowerCase()
      const rowCode = (row.orderInfo?.merchantCode ?? '').toLowerCase()
      const rowName = (row.orderInfo?.merchantName ?? '').toLowerCase()

      const codeMatch = codes.length > 0 && codes.some((c) => c.toLowerCase() === rowCode)
      const nameMatch = keyword !== '' && rowName.includes(keyword)

      if (!codeMatch && !nameMatch) return false
    }

    if (timeoutActive) {
      const daysDiff = calcLastEventDaysDiff(row.trackEvents)
      if (daysDiff == null) return false
      if (timeoutFilter.minDays != null && daysDiff < timeoutFilter.minDays) return false
      if (timeoutFilter.maxDays != null && daysDiff > timeoutFilter.maxDays) return false
    }

    return true
  })
}
