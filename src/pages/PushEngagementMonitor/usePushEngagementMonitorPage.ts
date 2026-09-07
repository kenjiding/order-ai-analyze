import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { loadSupplierPushCatalog } from '../../shared/supplierPushConfig/catalogApi'
import { supplierDisplayName } from '../../shared/supplierPushConfig/display'
import type { SupplierPushConfig } from '../../shared/supplierPushConfig/types'
import { showToast } from '../../utils/toast'
import { peT } from './pushEngagementI18n'
import { groupKey, groupRowsByDate, mergeReadStatuses, type LabelGroup } from './pushEngagementGrouping'
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
  /** 第二级展开的 key（日期 + 推送类型），一个日期下可同时展开多个类型 */
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([])
  const [readStatusByGroup, setReadStatusByGroup] = useState<Record<string, DetailState<PushReadStatus>>>({})
  const [clickEventsByGroup, setClickEventsByGroup] = useState<Record<string, DetailState<PushClickEvent[]>>>({})
  /** 记录哪些分组已经拉过详情，展开/收起同一分组不重复发请求 */
  const requestedGroupsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    void (async () => {
      setSuppliersLoading(true)
      const res = await loadSupplierPushCatalog()
      setSuppliersLoading(false)
      if (!res.ok) {
        showToast(peT('loadSuppliersFailed', { error: res.error }), 'error')
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
    setExpandedGroupKeys([])
    setReadStatusByGroup({})
    setClickEventsByGroup({})
    requestedGroupsRef.current = new Set()
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

  /** 单个分组的点击记录：查我方库，毫秒级，跟已读一起在展开该类型时触发 */
  const loadClickEventsForGroup = useCallback(async (date: string, labelGroup: LabelGroup) => {
    const key = groupKey(date, labelGroup.pushLabel)
    setClickEventsByGroup((prev) => ({ ...prev, [key]: { status: 'loading' } }))
    const res = await fetchPushMessageClickEventsBatch(labelGroup.rows.map((r) => r.id))
    setClickEventsByGroup((prev) => ({
      ...prev,
      [key]: res.ok
        ? { status: 'ready', data: labelGroup.rows.flatMap((r) => res.data[r.id] ?? []) }
        : { status: 'error', error: res.error },
    }))
  }, [])

  /**
   * 单个「推送类型」分组的已读查询：只带这一组的消息 id，请求量级从"一整天"降到"一个类型"。
   * 后端按条降级，部分成功也照常展示，失败的条数用 partialError 标出来，不整组当失败。
   */
  const loadReadStatusForGroup = useCallback(async (date: string, labelGroup: LabelGroup) => {
    const key = groupKey(date, labelGroup.pushLabel)
    const nonExpiredRows = labelGroup.rows.filter((r) => !r.readWindowExpired)
    if (nonExpiredRows.length === 0) {
      setReadStatusByGroup((prev) => ({ ...prev, [key]: { status: 'expired' } }))
      return
    }
    setReadStatusByGroup((prev) => ({ ...prev, [key]: { status: 'loading' } }))
    const res = await fetchPushMessageReadStatusBatch(nonExpiredRows.map((r) => r.id))
    if (!res.ok) {
      setReadStatusByGroup((prev) => ({ ...prev, [key]: { status: 'error', error: res.error } }))
      return
    }
    const ok = nonExpiredRows.map((r) => res.data[r.id]).filter((d): d is PushReadStatus => Boolean(d))
    if (ok.length === 0) {
      const firstError = nonExpiredRows.map((r) => res.errors[r.id]).find(Boolean)
      setReadStatusByGroup((prev) => ({ ...prev, [key]: { status: 'error', error: firstError ?? peT('readStatusFailed') } }))
      return
    }
    const failedCount = nonExpiredRows.length - ok.length
    const firstError = nonExpiredRows.map((r) => res.errors[r.id]).find(Boolean)
    setReadStatusByGroup((prev) => ({
      ...prev,
      [key]: {
        status: 'ready',
        data: mergeReadStatuses(ok),
        partialError: failedCount > 0 ? peT('readPartialFailed', { failed: failedCount, total: nonExpiredRows.length, reason: firstError ?? peT('unknownReason') }) : undefined,
      },
    }))
  }, [])

  const loadGroupDetail = useCallback(
    (date: string, labelGroup: LabelGroup) => {
      void loadReadStatusForGroup(date, labelGroup)
      void loadClickEventsForGroup(date, labelGroup)
    },
    [loadReadStatusForGroup, loadClickEventsForGroup],
  )

  /** 展开日期只列出该日期有哪些推送类型，一条数据都不拉；真正的请求由展开某个类型触发 */
  const onExpandDate = useCallback((expanded: boolean, date: string) => {
    setExpandedDates((prev) => (expanded ? [...prev, date] : prev.filter((d) => d !== date)))
  }, [])

  /** 第二级展开：首次展开某个推送类型时拉它的已读 + 点击，收起再展开不重复请求 */
  const onExpandGroup = useCallback(
    (expanded: boolean, date: string, labelGroup: LabelGroup) => {
      const key = groupKey(date, labelGroup.pushLabel)
      setExpandedGroupKeys((prev) => (expanded ? [...prev, key] : prev.filter((k) => k !== key)))
      if (!expanded || requestedGroupsRef.current.has(key)) return
      requestedGroupsRef.current.add(key)
      loadGroupDetail(date, labelGroup)
    },
    [loadGroupDetail],
  )

  /** 刷新：绕过"已请求过"的记录强制重查当前分组 */
  const refreshGroup = useCallback(
    (date: string, labelGroup: LabelGroup) => {
      requestedGroupsRef.current.add(groupKey(date, labelGroup.pushLabel))
      loadGroupDetail(date, labelGroup)
    },
    [loadGroupDetail],
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
    expandedGroupKeys,
    onExpandGroup,
    refreshGroup,
    readStatusByGroup,
    clickEventsByGroup,
    summary,
  }
}
