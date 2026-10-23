import { useCallback, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { i18n } from '../../i18n'
import {
  buildDimensionRangeStats,
  buildRangeStats,
  computeWeightSummary,
  fetchWeightStat,
  type WeightDimension,
  type WeightRange,
  type WeightStatResult,
} from './weightStatApi'

const MAX_RANGE_DAYS = 7

function makeRangeId(min: number, max: number): string {
  return `${min}-${max}`
}

export function useWeightStatPage() {
  const { t } = useTranslation('weightStat')
  const { imileToken } = useAppSettings()
  const stationCode = useGlobalFilterStore((state) => state.selectedStations[0] ?? '')

  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(1, 'day'),
    dayjs().subtract(1, 'day'),
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WeightStatResult | null>(null)
  const [ranges, setRanges] = useState<WeightRange[]>([])
  const [dimension, setDimension] = useState<WeightDimension>('supplier')

  const summary = useMemo(
    () => (result ? computeWeightSummary(result.items) : null),
    [result],
  )

  const rangeStats = useMemo(
    () => (result ? buildRangeStats(result.items, ranges) : []),
    [result, ranges],
  )

  const dimensionRangeStats = useMemo(
    () => (result ? buildDimensionRangeStats(result.items, dimension, ranges) : []),
    [result, dimension, ranges],
  )

  const canSubmit = Boolean(stationCode && dateRange && !loading)

  const handleQuery = useCallback(async () => {
    if (!stationCode) {
      showToast(t('toast.selectStation'), 'warning')
      return
    }
    if (!dateRange) {
      showToast(t('toast.selectDate'), 'warning')
      return
    }
    if (dateRange[1].diff(dateRange[0], 'day') + 1 > MAX_RANGE_DAYS) {
      showToast(t('toast.maxRange'), 'warning')
      return
    }
    const token = imileToken.trim()
    if (!token) {
      showToast(String(i18n.t('imileTokenRequired', { ns: 'common' })), 'warning')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const data = await fetchWeightStat({
        imileToken: token,
        stationCode,
        startDate: dateRange[0].format('YYYY-MM-DD'),
        endDate: dateRange[1].format('YYYY-MM-DD'),
      })
      setResult(data)
      showToast(t('toast.done', { count: data.items.length }), 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('toast.selectDate')
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [dateRange, imileToken, stationCode, t])

  const addRange = useCallback(
    (min: number, max: number) => {
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
        showToast(t('toast.rangeInvalid'), 'warning')
        return
      }
      const id = makeRangeId(min, max)
      if (ranges.some((r) => r.id === id)) {
        showToast(t('toast.rangeDuplicate'), 'warning')
        return
      }
      setRanges((prev) => [...prev, { id, min, max }])
    },
    [ranges, t],
  )

  const removeRange = useCallback((id: string) => {
    setRanges((prev) => prev.filter((r) => r.id !== id))
  }, [])

  return {
    dateRange,
    setDateRange,
    loading,
    error,
    result,
    summary,
    ranges,
    rangeStats,
    addRange,
    removeRange,
    dimension,
    setDimension,
    dimensionRangeStats,
    handleQuery,
    canSubmit,
    stationCode,
  }
}
