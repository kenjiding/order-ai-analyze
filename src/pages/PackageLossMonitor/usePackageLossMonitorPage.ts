import { useCallback, useMemo, useRef, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { PERMISSION_KEYS } from '../../hooks/usePermission'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
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
  const [postFilterDraft, setPostFilterDraft] = useState<PostFilterConfig>(DEFAULT_POST_FILTER_CONFIG)
  const [appliedPostFilter, setAppliedPostFilter] = useState<PostFilterConfig>(DEFAULT_POST_FILTER_CONFIG)
  const analyzeRunIdRef = useRef(0)

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
    setIsQuerying(false)
    setIsAnalyzing(false)
    setQueryMeta(null)
    setImportMeta({ fileName: parsed.fileName, total: parsed.rows.length })
    setAnalysisRows(parsed.rows)
    setAnalyzeProgress(null)
    setPostFilterDraft(DEFAULT_POST_FILTER_CONFIG)
    setAppliedPostFilter(DEFAULT_POST_FILTER_CONFIG)
    showToast(`已导入 ${parsed.rows.length} 单分析结果`, 'success')
  }, [])

  const onAnalyzeInHub = useCallback(async () => {
    const token = imileToken.trim()
    if (!token) {
      showToast('请在右上角系统设置中填写 iMile Bearer Token', 'error')
      return
    }
    if (!stationCode) {
      showToast('请先在右上角选择责任站点', 'error')
      return
    }
    if (!Number.isFinite(lossTimeoutDays) || lossTimeoutDays < 1) {
      showToast('请填写有效的超时天数', 'error')
      return
    }
    const [startAt, endAt] = dateRange
    if (!startAt || !endAt || !startAt.isValid() || !endAt.isValid()) {
      showToast('请选择有效的时间范围', 'error')
      return
    }
    if (endAt.isBefore(startAt)) {
      showToast('结束时间不能早于开始时间', 'error')
      return
    }
    const diffDays = endAt.diff(startAt, 'day', true)
    if (diffDays > MAX_QUERY_RANGE_DAYS) {
      showToast('异常完结查询时间范围不能超过 1 个月', 'error')
      return
    }
    const timeoutDays = Math.floor(lossTimeoutDays)
    const start = startAt.startOf('day').format(DATE_TIME_FORMAT)
    const end = endAt.endOf('day').format(DATE_TIME_FORMAT)

    const runId = analyzeRunIdRef.current + 1
    analyzeRunIdRef.current = runId
    const isStaleRun = () => analyzeRunIdRef.current !== runId

    setIsQuerying(true)
    resetResultView()

    let waybillNos: string[]
    try {
      const fetched = await postInHubPackageLossWaybills({ imileToken: token, stationCode, start, end })
      if (isStaleRun()) return
      setQueryMeta(fetched)
      if (fetched.waybillNos.length === 0) {
        showToast('当前站点没有库内丢包运单', 'error')
        return
      }
      waybillNos = fetched.waybillNos
    } catch (e) {
      if (isStaleRun()) return
      showToast((e as Error).message || '库内丢包运单查询失败', 'error')
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
      setAnalysisRows((prev) =>
        prev.map((row) =>
          row.orderNo === orderNo ? { ...row, status: 'analyzing' as const, reason: '分析中…' } : row,
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
        const message = (e as Error).message || '分析失败'
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
    setIsAnalyzing(false)
    if (failed === 0) {
      showToast('分析完成', 'success')
    } else if (succeeded === 0) {
      showToast('全部分析失败，请检查网络或 Token 后重试', 'error')
    } else {
      showToast(`分析结束：${succeeded} 单成功，${failed} 单失败`, 'error')
    }
  }, [dateRange, imileToken, lossTimeoutDays, resetResultView, stationCode])

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
