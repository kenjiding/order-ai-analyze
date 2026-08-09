import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { loadSupplierPushCatalog } from '../../shared/supplierPushConfig/catalogApi'
import { supplierDisplayName } from '../../shared/supplierPushConfig/display'
import type { SupplierPushConfig } from '../../shared/supplierPushConfig/types'
import { showToast } from '../../utils/toast'
import {
  fetchPushEngagementList,
  fetchPushMessageClickEvents,
  fetchPushMessageReadStatus,
} from './pushEngagementApi'
import type { PushClickEvent, PushEngagementRow, PushReadStatus } from './pushEngagementTypes'

type DetailState<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T }

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

  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([])
  const [readStatusById, setReadStatusById] = useState<Record<string, DetailState<PushReadStatus>>>({})
  const [clickEventsById, setClickEventsById] = useState<Record<string, DetailState<PushClickEvent[]>>>({})

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

  const loadReadStatus = useCallback((row: PushEngagementRow) => {
    setReadStatusById((prev) => ({ ...prev, [row.id]: { status: 'loading' } }))
    void (async () => {
      const res = await fetchPushMessageReadStatus(row.id)
      setReadStatusById((prev) => ({
        ...prev,
        [row.id]: res.ok ? { status: 'ready', data: res.data } : { status: 'error', error: res.error },
      }))
    })()
  }, [])

  const loadClickEvents = useCallback((row: PushEngagementRow) => {
    setClickEventsById((prev) => ({ ...prev, [row.id]: { status: 'loading' } }))
    void (async () => {
      const res = await fetchPushMessageClickEvents(row.id)
      setClickEventsById((prev) => ({
        ...prev,
        [row.id]: res.ok ? { status: 'ready', data: res.data } : { status: 'error', error: res.error },
      }))
    })()
  }, [])

  const onExpandRow = useCallback(
    (expanded: boolean, row: PushEngagementRow) => {
      setExpandedRowKeys((prev) => (expanded ? [...prev, row.id] : prev.filter((id) => id !== row.id)))
      if (!expanded) return
      if (!row.readWindowExpired && !readStatusById[row.id]) loadReadStatus(row)
      if (!clickEventsById[row.id]) loadClickEvents(row)
    },
    [readStatusById, clickEventsById, loadReadStatus, loadClickEvents],
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
    rows,
    rowsLoading,
    rowsError,
    reload,
    expandedRowKeys,
    onExpandRow,
    readStatusById,
    clickEventsById,
    summary,
  }
}
