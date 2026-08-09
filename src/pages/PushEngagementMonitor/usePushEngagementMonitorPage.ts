import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { loadSupplierPushCatalog } from '../../shared/supplierPushConfig/catalogApi'
import { supplierDisplayName } from '../../shared/supplierPushConfig/display'
import type { SupplierPushConfig } from '../../shared/supplierPushConfig/types'
import { showToast } from '../../utils/toast'
import { groupKey, groupRowsByDate, groupRowsByLabel, mergeReadStatuses, type LabelGroup } from './pushEngagementGrouping'
import {
  fetchPushEngagementList,
  fetchPushMessageClickEvents,
  fetchPushMessageReadStatus,
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

  const loadLabelGroupDetail = useCallback((date: string, labelGroup: LabelGroup) => {
    const key = groupKey(date, labelGroup.pushLabel)
    setReadStatusByGroup((prev) => ({ ...prev, [key]: { status: 'loading' } }))
    setClickEventsByGroup((prev) => ({ ...prev, [key]: { status: 'loading' } }))

    void (async () => {
      const nonExpiredRows = labelGroup.rows.filter((r) => !r.readWindowExpired)
      if (nonExpiredRows.length === 0) {
        setReadStatusByGroup((prev) => ({ ...prev, [key]: { status: 'expired' } }))
        return
      }
      const results = await Promise.all(nonExpiredRows.map((r) => fetchPushMessageReadStatus(r.id)))
      const ok = results.filter((r): r is { ok: true; data: PushReadStatus } => r.ok)
      if (ok.length === 0) {
        const firstError = results.find((r) => !r.ok)
        setReadStatusByGroup((prev) => ({
          ...prev,
          [key]: { status: 'error', error: firstError && !firstError.ok ? firstError.error : '查询已读状态失败。' },
        }))
        return
      }
      setReadStatusByGroup((prev) => ({ ...prev, [key]: { status: 'ready', data: mergeReadStatuses(ok.map((r) => r.data)) } }))
    })()

    void (async () => {
      const results = await Promise.all(labelGroup.rows.map((r) => fetchPushMessageClickEvents(r.id)))
      const ok = results.filter((r): r is { ok: true; data: PushClickEvent[] } => r.ok)
      if (ok.length === 0 && results.length > 0) {
        const firstError = results[0]
        setClickEventsByGroup((prev) => ({
          ...prev,
          [key]: { status: 'error', error: !firstError.ok ? firstError.error : '查询点击记录失败。' },
        }))
        return
      }
      setClickEventsByGroup((prev) => ({ ...prev, [key]: { status: 'ready', data: ok.flatMap((r) => r.data) } }))
    })()
  }, [])

  const onExpandDate = useCallback(
    (expanded: boolean, date: string) => {
      setExpandedDates((prev) => (expanded ? [...prev, date] : prev.filter((d) => d !== date)))
      if (!expanded) return
      const group = dateGroups.find((g) => g.date === date)
      if (!group) return
      for (const labelGroup of groupRowsByLabel(group.rows)) {
        const key = groupKey(date, labelGroup.pushLabel)
        if (!readStatusByGroup[key] && !clickEventsByGroup[key]) loadLabelGroupDetail(date, labelGroup)
      }
    },
    [dateGroups, readStatusByGroup, clickEventsByGroup, loadLabelGroupDetail],
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
