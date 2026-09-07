import { useCallback, useMemo, useRef, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { PERMISSION_KEYS } from '../../hooks/usePermission'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { plT } from './packageLossI18n'
import { DEFAULT_POST_FILTER_CONFIG } from '../OrderExceptionManagement/postFilter/defaults'
import { applyPostFilter } from '../OrderExceptionManagement/postFilter/applyPostFilter'
import type { PostFilterConfig } from '../OrderExceptionManagement/postFilter/types'
import type { AnalysisRow, AnalyzeProgress } from '../OrderExceptionManagement/analysisTypes'
import { createPendingAnalysisRow, mapAnalyzeHitToRow } from '../OrderExceptionManagement/mapAnalyzeHitToRow'
import { parseAnalysisResultsFromFile } from '../OrderExceptionManagement/analysisExport'
import {
  postInHubPackageLossAnalyze,
  postInHubPackageLossWaybills,
  type InHubPackageLossWaybills,
} from './packageLossMonitorApi'
import { buildInHubLossAnalytics } from './inHubLossAnalytics'

export type PackageLossTabId = 'in-hub' | 'out-hub'
export type PackageLossDateRange = [Dayjs, Dayjs]

export type PackageLossImportMeta = {
  fileName: string
  total: number
}

export const DEFAULT_PACKAGE_LOSS_TIMEOUT_DAYS = 3
const MAX_QUERY_RANGE_DAYS = 31
const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'

export function usePackageLossMonitorPage() {
  const { imileToken } = useAppSettings()
  const stationCode = useGlobalFilterStore((state) => state.selectedStations[0])
  const stations = useGlobalFilterStore((state) => state.stations)
  const stationLabel =
    stations.find((item) => item.value === stationCode)?.label ?? stationCode ?? ''

  const [activeTab, setActiveTab] = useState<PackageLossTabId>('in-hub')
  const [lossTimeoutDays, setLossTimeoutDays] = useState<number>(DEFAULT_PACKAGE_LOSS_TIMEOUT_DAYS)
  const [dateRange, setDateRange] = useState<PackageLossDateRange>([
    dayjs().subtract(30, 'day'),
    dayjs(),
  ])
  const [isQuerying, setIsQuerying] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [queryMeta, setQueryMeta] = useState<InHubPackageLossWaybills | null>(null)
  const [importMeta, setImportMeta] = useState<PackageLossImportMeta | null>(null)
  const [analysisRows, setAnalysisRows] = useState<AnalysisRow[]>([])
  const [analyzeProgress, setAnalyzeProgress] = useState<AnalyzeProgress | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [postFilterDraft, setPostFilterDraft] = useState<PostFilterConfig>(DEFAULT_POST_FILTER_CONFIG)
  const [appliedPostFilter, setAppliedPostFilter] = useState<PostFilterConfig>(DEFAULT_POST_FILTER_CONFIG)
  const analyzeRunIdRef = useRef(0)
  const isPausedRef = useRef(false)
  const pauseResolveRef = useRef<(() => void) | null>(null)

  /** 逐单分析循环每轮开始前调用；暂停期间挂起，直到 onResumeAnalyze 被调用 */
  const waitWhilePaused = useCallback(async () => {
    while (isPausedRef.current) {
      await new Promise<void>((resolve) => {
        pauseResolveRef.current = resolve
      })
    }
  }, [])

  /** 清除暂停状态，并唤醒仍挂起的循环（新一轮分析或导入打断时必须调用，否则旧循环永远卡住） */
  const clearPause = useCallback(() => {
    isPausedRef.current = false
    setIsPaused(false)
    pauseResolveRef.current?.()
    pauseResolveRef.current = null
  }, [])

  const onPauseAnalyze = useCallback(() => {
    isPausedRef.current = true
    setIsPaused(true)
  }, [])

  const filteredAnalysisRows = useMemo(
    () => applyPostFilter(analysisRows, appliedPostFilter),
    [analysisRows, appliedPostFilter],
  )
  const inHubLossAnalytics = useMemo(
    () => buildInHubLossAnalytics(filteredAnalysisRows),
    [filteredAnalysisRows],
  )

  const runPostFilter = useCallback(() => {
    setAppliedPostFilter(postFilterDraft)
  }, [postFilterDraft])

  const resetResultView = useCallback(() => {
    setQueryMeta(null)
    setImportMeta(null)
    setAnalysisRows([])
    setAnalyzeProgress(null)
    setPostFilterDraft(DEFAULT_POST_FILTER_CONFIG)
    setAppliedPostFilter(DEFAULT_POST_FILTER_CONFIG)
  }, [])

  const onImportAnalysisResults = useCallback(async (file: File) => {
    const parsed = await parseAnalysisResultsFromFile(file)
    if (!parsed.ok) {
      showToast(parsed.error, 'error')
      return
    }

    analyzeRunIdRef.current += 1
    clearPause()
    setIsQuerying(false)
    setIsAnalyzing(false)
    setQueryMeta(null)
    setImportMeta({ fileName: parsed.fileName, total: parsed.rows.length })
    setAnalysisRows(parsed.rows)
    setAnalyzeProgress(null)
    setPostFilterDraft(DEFAULT_POST_FILTER_CONFIG)
    setAppliedPostFilter(DEFAULT_POST_FILTER_CONFIG)
    showToast(plT('toast.imported', { count: parsed.rows.length }), 'success')
  }, [clearPause])

  const onAnalyzeInHub = useCallback(async () => {
    const token = imileToken.trim()
    if (!token) {
      showToast(plT('toast.imileToken'), 'error')
      return
    }
    if (!stationCode) {
      showToast(plT('toast.selectStation'), 'error')
      return
    }
    if (!Number.isFinite(lossTimeoutDays) || lossTimeoutDays < 1) {
      showToast(plT('toast.invalidIdleDays'), 'error')
      return
    }
    const [startAt, endAt] = dateRange
    if (!startAt || !endAt || !startAt.isValid() || !endAt.isValid()) {
      showToast(plT('toast.invalidTimeRange'), 'error')
      return
    }
    if (endAt.isBefore(startAt)) {
      showToast(plT('toast.endBeforeStart'), 'error')
      return
    }
    const diffDays = endAt.diff(startAt, 'day', true)
    if (diffDays > MAX_QUERY_RANGE_DAYS) {
      showToast(plT('toast.rangeTooLong'), 'error')
      return
    }
    const timeoutDays = Math.floor(lossTimeoutDays)
    const start = startAt.startOf('day').format(DATE_TIME_FORMAT)
    const end = endAt.endOf('day').format(DATE_TIME_FORMAT)

    const runId = analyzeRunIdRef.current + 1
    analyzeRunIdRef.current = runId
    const isStaleRun = () => analyzeRunIdRef.current !== runId

    clearPause()
    setIsQuerying(true)
    resetResultView()

    let waybillNos: string[]
    try {
      const fetched = await postInHubPackageLossWaybills({ imileToken: token, stationCode, start, end })
      if (isStaleRun()) return
      setQueryMeta(fetched)
      if (fetched.waybillNos.length === 0) {
        showToast(plT('toast.noOrders'), 'error')
        return
      }
      waybillNos = fetched.waybillNos
    } catch (e) {
      if (isStaleRun()) return
      showToast((e as Error).message || plT('toast.queryFailed'), 'error')
      return
    } finally {
      if (!isStaleRun()) setIsQuerying(false)
    }

    setIsAnalyzing(true)
    setAnalysisRows(waybillNos.map(createPendingAnalysisRow))
    setAnalyzeProgress({ total: waybillNos.length, completed: 0, succeeded: 0, failed: 0 })

    let succeeded = 0
    let failed = 0
    for (const orderNo of waybillNos) {
      if (isStaleRun()) return
      await waitWhilePaused()
      if (isStaleRun()) return
      setAnalysisRows((prev) =>
        prev.map((row) =>
          row.orderNo === orderNo ? { ...row, status: 'analyzing' as const, reason: plT('toast.analyzing') } : row,
        ),
      )
      try {
        const { results, trackInfo, orderInfo, interceptLogs } = await postInHubPackageLossAnalyze({
          imileToken: token,
          orderNos: [orderNo],
          scanStationCode: stationCode,
          lossTimeoutDays: timeoutDays,
        })
        if (isStaleRun()) return
        const row = mapAnalyzeHitToRow(
          orderNo,
          results.find((item) => item.orderNo === orderNo),
          trackInfo,
          interceptLogs,
          orderInfo ?? {},
        )
        setAnalysisRows((prev) => prev.map((item) => (item.orderNo === orderNo ? row : item)))
        succeeded += 1
      } catch (e) {
        if (isStaleRun()) return
        const message = (e as Error).message || plT('toast.analysisFailed')
        setAnalysisRows((prev) =>
          prev.map((item) =>
            item.orderNo === orderNo
              ? {
                  ...item,
                  status: 'error' as const,
                  reason: message,
                  lossScope: '—',
                  categoryName: '—',
                  currentResponsibilityParty: '—',
                  confidence: '—',
                }
              : item,
          ),
        )
        failed += 1
      }
      setAnalyzeProgress({
        total: waybillNos.length,
        completed: succeeded + failed,
        succeeded,
        failed,
      })
    }

    if (isStaleRun()) return
    clearPause()
    setIsAnalyzing(false)
    if (failed === 0) {
      showToast(plT('toast.analysisComplete'), 'success')
    } else if (succeeded === 0) {
      showToast(plT('toast.allFailed'), 'error')
    } else {
      showToast(plT('toast.partialFailed', { succeeded, failed }), 'error')
    }
  }, [clearPause, dateRange, imileToken, lossTimeoutDays, resetResultView, stationCode, waitWhilePaused])

  return {
    activeTab,
    setActiveTab,
    stationCode,
    stationLabel,
    dateRange,
    setDateRange,
    lossTimeoutDays,
    setLossTimeoutDays,
    isQuerying,
    isAnalyzing,
    isPaused,
    onPauseAnalyze,
    onResumeAnalyze: clearPause,
    queryMeta,
    importMeta,
    analysisRows,
    filteredAnalysisRows,
    analyzeProgress,
    inHubLossAnalytics,
    postFilterDraft,
    setPostFilterDraft,
    appliedPostFilter,
    runPostFilter,
    onAnalyzeInHub,
    onImportAnalysisResults,
    exportPermission: PERMISSION_KEYS.btnPackageLossMonitorAnalyze,
  }
}
