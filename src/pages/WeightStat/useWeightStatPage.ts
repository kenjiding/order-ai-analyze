import { useCallback, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { i18n } from '../../i18n'
import { exportWeightStatExcel } from './exportWeightStatExcel'
import {
  buildDimensionRangeStats,
  buildRangeStats,
  computeWeightSummary,
  fetchWeightStat,
  mergeWeightStatResults,
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
  const stations = useGlobalFilterStore((state) => state.stations)
  const initialStations = useGlobalFilterStore((state) => state.selectedStations)
  const stationOptions = useMemo(() => stations.map((s) => ({ label: s.label, value: s.value })), [stations])

  const [stationCodes, setStationCodes] = useState<string[]>(initialStations)
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

  const canSubmit = Boolean(stationCodes.length > 0 && dateRange && !loading)

  const handleQuery = useCallback(async () => {
    if (stationCodes.length === 0) {
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
    const startDate = dateRange[0].format('YYYY-MM-DD')
    const endDate = dateRange[1].format('YYYY-MM-DD')
    const succeeded: WeightStatResult[] = []
    const failed: string[] = []
    let lastErrorMessage = ''
    // 逐站点顺序拉取，避免并发打满 iMile 接口（与派签/滞留告警的站点遍历方式一致）
    for (const stationCode of stationCodes) {
      try {
        const data = await fetchWeightStat({ imileToken: token, stationCode, startDate, endDate })
        succeeded.push(data)
      } catch (err) {
        failed.push(stationCode)
        lastErrorMessage = err instanceof Error ? err.message : String(err)
      }
    }
    if (succeeded.length === 0) {
      const msg = lastErrorMessage ? `${t('toast.allFailed')}：${lastErrorMessage}` : t('toast.allFailed')
      setError(msg)
      showToast(msg, 'error')
      setLoading(false)
      return
    }
    const merged = mergeWeightStatResults(succeeded)
    setResult(merged)
    if (failed.length > 0) {
      showToast(t('toast.partialFailure', { stations: failed.join(', ') }), 'warning')
    } else {
      showToast(t('toast.done', { count: merged.items.length }), 'success')
    }
    setLoading(false)
  }, [dateRange, imileToken, stationCodes, t])

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

  const [exporting, setExporting] = useState(false)

  const canExport = Boolean(result && ranges.length > 0 && !exporting)

  const handleExport = useCallback(async () => {
    if (!result || ranges.length === 0) return
    setExporting(true)
    try {
      await exportWeightStatExcel(result, ranges)
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('export.failed'), 'error')
    } finally {
      setExporting(false)
    }
  }, [result, ranges, t])

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
    stationCodes,
    setStationCodes,
    stationOptions,
    exporting,
    canExport,
    handleExport,
  }
}
