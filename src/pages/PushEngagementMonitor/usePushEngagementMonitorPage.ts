import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { loadSupplierPushCatalog } from '../../shared/supplierPushConfig/catalogApi'
import { supplierDisplayName } from '../../shared/supplierPushConfig/display'
import type { SupplierPushConfig } from '../../shared/supplierPushConfig/types'
import { showToast } from '../../utils/toast'
import { groupKey, groupRowsByDate, groupRowsByLabel, mergeReadStatuses, type LabelGroup } from './pushEngagementGrouping'
import {
  fetchPushEngagementList,
  fetchPushMessageClickEventsBatch,
  fetchPushMessageReadStatusBatch,
} from './pushEngagementApi'
import type { DetailState, PushClickEvent, PushEngagementRow, PushReadStatus } from './pushEngagementTypes'

export function usePushEngagementMonitorPage() {
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')])
  const [pushLabels, setPushLabels] = useState<string[]>([])
  const [supplierConfigId, setSupplierConfigId] = useState<string | null>(null)
  const [regionCode, setRegionCode] = useState<string | null>(null)

  const [suppliers, setSuppliers] = useState<SupplierPushConfig[]>([])
  const [suppliersLoading, setSuppliersLoading] = useState(true)

  const [rows, setRows] = useState<PushEngagementRow[]>([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [rowsError, setRowsError] = useState<string | null>(null)

  const [expandedDates, setExpandedDates] = useState<string[]>([])
  const [readStatusByGroup, setReadStatusByGroup] = useState<Record<string, DetailState<PushReadStatus>>>({})
  const [clickEventsByGroup, setClickEventsByGroup] = useState<Record<string, DetailState<PushClickEvent[]>>>({})
  /** 记录哪些日期已经批量拉取过详情，展开/收起同一日期不重复发请求 */
  const requestedDatesRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    void (async () => {
      setSuppliersLoading(true)
      const res = await loadSupplierPushCatalog()
      setSuppliersLoading(false)
      if (!res.ok) {
        showToast(`获取供应商列表失败：${res.error}`, 'error')
        return
      }
      setSuppliers(res.data)
    })()
  }, [])

  const reload = useCallback(async () => {
    setRowsLoading(true)
    setRowsError(null)
    const res = await fetchPushEngagementList({
      startDate: dateRange[0].format('YYYY-MM-DD'),
      endDate: dateRange[1].format('YYYY-MM-DD'),
      pushLabel: pushLabels.length === 1 ? pushLabels[0] : undefined,
      supplierConfigId: supplierConfigId ?? undefined,
      regionCode: regionCode ?? undefined,
    })
    setRowsLoading(false)
    if (!res.ok) {
      setRowsError(res.error)
      setRows([])
      return
    }
    // pushLabel 多选（>1 项）时后端只支持单值过滤，前端补一道过滤
    const filtered = pushLabels.length > 1 ? res.data.filter((r) => r.pushLabel && pushLabels.includes(r.pushLabel)) : res.data
    setRows(filtered)
    setExpandedDates([])
    setReadStatusByGroup({})
    setClickEventsByGroup({})
    requestedDatesRef.current = new Set()
  }, [dateRange, pushLabels, supplierConfigId, regionCode])

  useEffect(() => {
    void reload()
  }, [reload])

  const supplierOptions = useMemo(
    () =>
      suppliers
        .slice()
        .sort((a, b) => supplierDisplayName(a).localeCompare(supplierDisplayName(b)))
        .map((s) => ({ label: `${supplierDisplayName(s)}（${s.regionCode}）`, value: s.id })),
    [suppliers],
  )

  const dateGroups = useMemo(() => groupRowsByDate(rows), [rows])

  /**
   * 一个日期下常有多条独立推送消息（跨多个 pushLabel）。展开日期时不再逐条消息发请求，
   * 而是把该日期下所有消息 id 合并成一次已读批量请求 + 一次点击批量批量请求，再按 pushLabel 拆回各分组展示。
   */
  const loadDateDetail = useCallback((date: string, labelGroups: LabelGroup[]) => {
    const keys = labelGroups.map((lg) => groupKey(date, lg.pushLabel))
    setReadStatusByGroup((prev) => {
      const next = { ...prev }
      for (const key of keys) next[key] = { status: 'loading' }
      return next
    })
    setClickEventsByGroup((prev) => {
      const next = { ...prev }
      for (const key of keys) next[key] = { status: 'loading' }
      return next
    })

    void (async () => {
      const nonExpiredIds = labelGroups.flatMap((lg) => lg.rows.filter((r) => !r.readWindowExpired).map((r) => r.id))
      const res = nonExpiredIds.length > 0 ? await fetchPushMessageReadStatusBatch(nonExpiredIds) : null
      const results: Record<string, DetailState<PushReadStatus>> = {}
      for (const labelGroup of labelGroups) {
        const key = groupKey(date, labelGroup.pushLabel)
        const groupNonExpiredRows = labelGroup.rows.filter((r) => !r.readWindowExpired)
        if (groupNonExpiredRows.length === 0) {
          results[key] = { status: 'expired' }
          continue
        }
        if (!res || !res.ok) {
          results[key] = { status: 'error', error: res && !res.ok ? res.error : '查询已读状态失败。' }
          continue
        }
        const ok = groupNonExpiredRows.map((r) => res.data[r.id]).filter((d): d is PushReadStatus => Boolean(d))
        if (ok.length === 0) {
          results[key] = { status: 'error', error: '查询已读状态失败。' }
          continue
        }
        results[key] = { status: 'ready', data: mergeReadStatuses(ok) }
      }
      setReadStatusByGroup((prev) => ({ ...prev, ...results }))
    })()

    void (async () => {
      const allIds = labelGroups.flatMap((lg) => lg.rows.map((r) => r.id))
      const res = await fetchPushMessageClickEventsBatch(allIds)
      const results: Record<string, DetailState<PushClickEvent[]>> = {}
      for (const labelGroup of labelGroups) {
        const key = groupKey(date, labelGroup.pushLabel)
        if (!res.ok) {
          results[key] = { status: 'error', error: res.error }
          continue
        }
        results[key] = { status: 'ready', data: labelGroup.rows.flatMap((r) => res.data[r.id] ?? []) }
      }
      setClickEventsByGroup((prev) => ({ ...prev, ...results }))
    })()
  }, [])

  const onExpandDate = useCallback(
    (expanded: boolean, date: string) => {
      setExpandedDates((prev) => (expanded ? [...prev, date] : prev.filter((d) => d !== date)))
      if (!expanded) return
      if (requestedDatesRef.current.has(date)) return
      const group = dateGroups.find((g) => g.date === date)
      if (!group) return
      requestedDatesRef.current.add(date)
      loadDateDetail(date, groupRowsByLabel(group.rows))
    },
    [dateGroups, loadDateDetail],
  )

  const summary = useMemo(() => {
    const total = rows.length
    const totalClicks = rows.reduce(
      (sum, r) => sum + Object.values(r.clicks).reduce((s, n) => s + n, 0),
      0,
    )
    const noClickCount = rows.filter((r) => Object.values(r.clicks).reduce((s, n) => s + n, 0) === 0).length
    return { total, totalClicks, noClickCount }
  }, [rows])

  return {
    dateRange,
    setDateRange,
    pushLabels,
    setPushLabels,
    supplierConfigId,
    setSupplierConfigId,
    regionCode,
    setRegionCode,
    supplierOptions,
    suppliersLoading,
    rowsLoading,
    rowsError,
    reload,
    dateGroups,
    expandedDates,
    onExpandDate,
    readStatusByGroup,
    clickEventsByGroup,
    summary,
  }
}
