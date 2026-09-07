import type { Dayjs } from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { i18n } from '../../i18n'
import { fetchNewMerchantWaybills, type FetchNewMerchantWaybillsResult } from './newMerchantApi'
import {
  computeKpis,
  computeRouteCodePerformance,
  computeTransitDistribution,
  DEFAULT_ROUTE_CODE_THRESHOLDS,
  type KpiSummary,
  type RouteCodeRow,
  type RouteCodeThresholds,
  type TransitBucket,
  type WaybillRecord,
} from './metrics'

export type NewMerchantQueryMeta = FetchNewMerchantWaybillsResult['meta']

export type UseNewMerchantMonitorPage = {
  clientCodesText: string
  setClientCodesText: (v: string) => void
  dateRange: [Dayjs, Dayjs] | null
  setDateRange: (v: [Dayjs, Dayjs] | null) => void
  loading: boolean
  error: string | null
  records: WaybillRecord[]
  metrics: KpiSummary
  transitDistribution: TransitBucket[]
  routeCodeRows: RouteCodeRow[]
  thresholds: RouteCodeThresholds
  setThresholds: (next: RouteCodeThresholds) => void
  lastQueryMeta: NewMerchantQueryMeta | null
  handleQuery: () => Promise<void>
  canSubmit: boolean
}

function parseClientCodes(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of raw.split(/[,\s，;；]+/)) {
    const v = piece.trim().toUpperCase()
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

export function useNewMerchantMonitorPage(): UseNewMerchantMonitorPage {
  const { imileToken } = useAppSettings()
  const [clientCodesText, setClientCodesText] = useState('')
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [records, setRecords] = useState<WaybillRecord[]>([])
  const [lastQueryMeta, setLastQueryMeta] = useState<NewMerchantQueryMeta | null>(null)
  const [thresholds, setThresholds] = useState<RouteCodeThresholds>(DEFAULT_ROUTE_CODE_THRESHOLDS)

  const metrics = useMemo(() => computeKpis(records), [records])
  const transitDistribution = useMemo(() => computeTransitDistribution(records), [records])
  const routeCodeRows = useMemo(
    () => computeRouteCodePerformance(records, thresholds),
    [records, thresholds],
  )

  const canSubmit = clientCodesText.trim().length > 0 && dateRange !== null && !loading

  const handleQuery = useCallback(async () => {
    const clientCodes = parseClientCodes(clientCodesText)
    if (!clientCodes.length) {
      showToast(String(i18n.t('enterClientCodes', { ns: 'newMerchant' })), 'warning')
      return
    }
    if (!dateRange) {
      showToast(String(i18n.t('selectDateRange', { ns: 'newMerchant' })), 'warning')
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
      const startDate = dateRange[0].format('YYYY-MM-DD')
      const endDate = dateRange[1].format('YYYY-MM-DD')
      const result = await fetchNewMerchantWaybills({
        imileToken: token,
        clientCodes,
        startDate,
        endDate,
      })
      setRecords(result.records as WaybillRecord[])
      setLastQueryMeta(result.meta)
      showToast(String(i18n.t('queryDone', { ns: 'newMerchant', count: result.records.length })), 'success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(i18n.t('queryFailed', { ns: 'newMerchant' }))
      setError(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [clientCodesText, dateRange, imileToken])

  return {
    clientCodesText,
    setClientCodesText,
    dateRange,
    setDateRange,
    loading,
    error,
    records,
    metrics,
    transitDistribution,
    routeCodeRows,
    thresholds,
    setThresholds,
    lastQueryMeta,
    handleQuery,
    canSubmit,
  }
}
