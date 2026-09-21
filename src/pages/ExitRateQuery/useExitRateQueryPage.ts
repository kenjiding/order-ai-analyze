import { useCallback, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { i18n } from '../../i18n'
import {
  fetchExitRateQuery,
  matrixNextDayHoursAllZero,
  type ExitRateDimRow,
  type ExitRateQueryResult,
  type ExitRateSlice,
} from './exitRateQueryApi'

export type ExitRateDimTab = 'vendor' | 'route' | 'driver'

const ALL_DATES = null as string | null

export function useExitRateQueryPage() {
  const { t } = useTranslation('exitRateQuery')
  const { imileToken } = useAppSettings()
  const stationCode = useGlobalFilterStore((state) => state.selectedStations[0] ?? '')

  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(1, 'day'),
    dayjs().subtract(1, 'day'),
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExitRateQueryResult | null>(null)
  const [viewDate, setViewDate] = useState<string | null>(ALL_DATES)
  const [dimTab, setDimTab] = useState<ExitRateDimTab>('vendor')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [matrixTab, setMatrixTab] = useState<ExitRateDimTab>('route')
  const [matrixSelectedKey, setMatrixSelectedKey] = useState<string | null>(null)
  const [hideZeroMatrixRows, setHideZeroMatrixRows] = useState(false)
  const [dimView, setDimView] = useState<'chart' | 'table'>('chart')
  const [matrixView, setMatrixView] = useState<'chart' | 'table'>('chart')

  const view: ExitRateSlice | null = useMemo(() => {
    if (!result) return null
    if (!viewDate) return result
    return result.byDate[viewDate] ?? result
  }, [result, viewDate])

  const rowsForTab = useCallback(
    (tab: ExitRateDimTab): ExitRateDimRow[] => {
      if (!view) return []
      const rows = tab === 'route' ? view.routes : tab === 'driver' ? view.drivers : view.vendors
      return Array.isArray(rows) ? rows : []
    },
    [view],
  )

  const dimRows = useMemo(() => rowsForTab(dimTab), [dimTab, rowsForTab])
  const matrixRows = useMemo(() => {
    const rows = rowsForTab(matrixTab)
    if (!hideZeroMatrixRows || matrixTab === 'vendor') return rows
    return rows.filter((row) => !matrixNextDayHoursAllZero(row))
  }, [hideZeroMatrixRows, matrixTab, rowsForTab])

  const selectedRow = useMemo(
    () => (selectedKey == null ? null : (dimRows.find((row) => row.key === selectedKey) ?? null)),
    [dimRows, selectedKey],
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
    if (dateRange[1].diff(dateRange[0], 'day') + 1 > 7) {
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
      const data = await fetchExitRateQuery({
        imileToken: token,
        stationCode,
        startDate: dateRange[0].format('YYYY-MM-DD'),
        endDate: dateRange[1].format('YYYY-MM-DD'),
      })
      setResult(data)
      setViewDate(ALL_DATES)
      setSelectedKey(null)
      setMatrixSelectedKey(null)
      showToast(t('toast.done', { count: data.total }), 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('toast.selectDate')
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [dateRange, imileToken, stationCode, t])

  const onChangeTab = useCallback((tab: ExitRateDimTab) => {
    setDimTab(tab)
    setSelectedKey(null)
  }, [])

  const onChangeMatrixTab = useCallback((tab: ExitRateDimTab) => {
    setMatrixTab(tab)
    setMatrixSelectedKey(null)
  }, [])

  const onChangeViewDate = useCallback((date: string | null) => {
    setViewDate(date)
    setSelectedKey(null)
    setMatrixSelectedKey(null)
  }, [])

  return {
    dateRange,
    setDateRange,
    loading,
    error,
    result,
    view,
    viewDate,
    onChangeViewDate,
    dimTab,
    dimRows,
    selectedRow,
    selectedKey,
    setSelectedKey,
    onChangeTab,
    matrixTab,
    matrixRows,
    matrixSelectedKey,
    setMatrixSelectedKey,
    onChangeMatrixTab,
    hideZeroMatrixRows,
    setHideZeroMatrixRows,
    dimView,
    setDimView,
    matrixView,
    setMatrixView,
    handleQuery,
    canSubmit,
    stationCode,
  }
}

