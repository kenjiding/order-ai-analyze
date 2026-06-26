import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { postFeishuPushCard } from '../PushNotifications/feishuWebhookTestApi'
import type {
  ComplaintTicketRow,
  DriverPerformanceRow,
  DriverReturnRawRow,
  DriverWaybillRow,
  FineBi24hDispatchMetrics,
  FineBiVendorMetrics,
  HubUnprocessedTicketRow,
  LongTailOrderRow,
  NormalUnprocessedTicketRow,
  UnprocessedTicketsData,
  VendorMetricRow,
  VendorOption,
  VendorPushConfig,
  VendorPushConfigDraft,
  WaybillRow,
} from './vendorAnalysisTypes'
import {
  createConfig,
  deleteConfig,
  fetchComplaintTickets,
  fetchDriverWaybills,
  fetchDriverReturnWarning,
  fetchFineBi24hDispatchMetrics,
  fetchFineBiMetrics,
  fetchLongTailOrders,
  fetchUnprocessedTickets,
  fetchVendors,
  fetchWaybills,
  loadConfigs,
  updateConfig,
} from './vendorAnalysisApi'
import {
  dispatchRate24hColor,
} from './fineBi24hMetricsDisplay'
import {
  FINEBI_METRIC_NOT_MET_24H_LABEL,
  loadFineBiConnections,
  pickActive24hDispatchConnection,
  pickActivePickupConnection,
  saveFineBiConnections,
  toFineBiConnectionInput,
  type FineBiConnectionConfig,
} from './fineBiConnectionStorage'

export type FetchedData = {
  tickets: ComplaintTicketRow[]
  waybills: WaybillRow[]
  unprocessedTickets: UnprocessedTicketsData
  longTailOrders: LongTailOrderRow[]
  fineBiMetricsByVendor: Record<string, FineBiVendorMetrics>
  fineBi24hMetricsByVendor: Record<string, FineBi24hDispatchMetrics>
  driverYesterdayWaybills: DriverWaybillRow[]
  driverDayBeforeWaybills: DriverWaybillRow[]
  driverReturnRows: DriverReturnRawRow[]
  fetchedAt: Date
  startTime: string
  endTime: string
  ticketStartTime: string
  ticketEndTime: string
  /** FineBI 11点前出仓率：获取数据当天的昨天 */
  fineBiPickupEndTime: string
  /** FineBI 24小时签派率：获取数据当天的前天 */
  fineBi24hStartTime: string
  fineBi24hEndTime: string
}

export function useVendorAnalysisPage() {
  const { imileToken } = useAppSettings()
  const { selectedStations } = useGlobalFilterStore()

  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [complaintDateRange, setComplaintDateRange] = useState<[Dayjs, Dayjs] | null>(null)

  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(false)

  const [configs, setConfigs] = useState<VendorPushConfig[]>([])
  const [configsLoading, setConfigsLoading] = useState(false)

  const [fetchedData, setFetchedData] = useState<FetchedData | null>(null)
  const [dataFetching, setDataFetching] = useState(false)
  const [isPushingAll, setIsPushingAll] = useState(false)
  const [fineBiConnections, setFineBiConnections] = useState<FineBiConnectionConfig[]>(() =>
    loadFineBiConnections(),
  )

  const handleFineBiConnectionsChange = useCallback((next: FineBiConnectionConfig[]) => {
    setFineBiConnections(next)
    saveFineBiConnections(next)
  }, [])

  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    setVendorsLoading(true)
    void fetchVendors(imileToken).then((res) => {
      setVendorsLoading(false)
      if (res.ok) setVendors(res.data)
      else showToast(`供应商加载失败: ${res.error}`, 'error')
    })

    setConfigsLoading(true)
    void loadConfigs().then((res) => {
      setConfigsLoading(false)
      if (res.ok) setConfigs(res.data)
      else showToast(`推送配置加载失败: ${res.error}`, 'error')
    })
  }, [imileToken])

  // 当时间范围变化时，清空已缓存数据，提示用户重新获取
  const handleDateRangeChange = useCallback((range: [Dayjs, Dayjs] | null) => {
    setDateRange(range)
    if (fetchedData) {
      setFetchedData(null)
      showToast('时间范围已变更，请重新获取数据', 'info')
    }
  }, [fetchedData])

  const handleComplaintDateRangeChange = useCallback((range: [Dayjs, Dayjs] | null) => {
    setComplaintDateRange(range)
    if (fetchedData) {
      setFetchedData(null)
      showToast('客诉成立量时间范围已变更，请重新获取数据', 'info')
    }
  }, [fetchedData])

  const fetchAbortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    if (!dateRange) { showToast('请先选择时间范围', 'error'); return }
    if (selectedStations.length === 0) { showToast('请先选择责任站点（FineBI 指标需要）', 'error'); return }

    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller
    const signal = controller.signal

    const startTime = dateRange[0].format('YYYY-MM-DD 00:00:00')
    const endTime = dateRange[1].format('YYYY-MM-DD 23:59:59')

    const effectiveTicketRange = complaintDateRange ?? dateRange
    const ticketStartTime = effectiveTicketRange[0].format('YYYY-MM-DD 00:00:00')
    const ticketEndTime = effectiveTicketRange[1].format('YYYY-MM-DD 23:59:59')

    const vendorCodes = [...new Set(configs.map((c) => c.vendorCode).filter(Boolean))]

    const fineBiPickupConn = pickActivePickupConnection(fineBiConnections)
    const fineBi24hConn = pickActive24hDispatchConnection(fineBiConnections)
    if (vendorCodes.length > 0 && !fineBiPickupConn && !fineBi24hConn) {
      showToast(
        '请展开 FineBI 连接配置，至少为一组接口粘贴 widget/data 完整 URL',
        'error',
      )
      return
    }

    setDataFetching(true)
    setFetchedData(null)

    const yesterday = dayjs().subtract(1, 'day')
    const dayBefore = dayjs().subtract(2, 'day')
    const yesterdayStartTime = yesterday.format('YYYY-MM-DD 00:00:00')
    const yesterdayEndTime = yesterday.format('YYYY-MM-DD 23:59:59')
    const dayBeforeStartTime = dayBefore.format('YYYY-MM-DD 00:00:00')
    const dayBeforeEndTime = dayBefore.format('YYYY-MM-DD 23:59:59')
    const fineBi24hStartDate = dayBefore.format('YYYY-MM-DD')
    const fineBi24hEndDate = fineBi24hStartDate
    // 未处理工单：上周周一 00:00:00 ~ 昨天 23:59:59
    const lastMonday = dayjs().startOf('week').subtract(6, 'day')
    const unprocessedStartTime = lastMonday.format('YYYY-MM-DD 00:00:00')

    let ticketsRes: Awaited<ReturnType<typeof fetchComplaintTickets>>
    let waybillsRes: Awaited<ReturnType<typeof fetchWaybills>>
    let unprocessedRes: Awaited<ReturnType<typeof fetchUnprocessedTickets>>
    let longTailRes: Awaited<ReturnType<typeof fetchLongTailOrders>>
    let fineBiPickupRes: { ok: true; data: Record<string, FineBiVendorMetrics> } | { ok: false; error: string }
    let fineBi24hRes: { ok: true; data: Record<string, FineBi24hDispatchMetrics> } | { ok: false; error: string }
    let driverYesterdayRes: Awaited<ReturnType<typeof fetchDriverWaybills>>
    let driverDayBeforeRes: Awaited<ReturnType<typeof fetchDriverWaybills>>
    let driverReturnRes: Awaited<ReturnType<typeof fetchDriverReturnWarning>>

    try {
      ;[ticketsRes, waybillsRes, unprocessedRes, longTailRes, fineBiPickupRes, fineBi24hRes, driverYesterdayRes, driverDayBeforeRes, driverReturnRes] =
        await Promise.all([
        fetchComplaintTickets(imileToken, { startTime: ticketStartTime, endTime: ticketEndTime }, signal),
        fetchWaybills(imileToken, { startTime, endTime }, signal),
        fetchUnprocessedTickets(imileToken, { startTime: unprocessedStartTime, endTime: yesterdayEndTime }, signal),
        fetchLongTailOrders(imileToken, { stationCodes: selectedStations }, signal),
        vendorCodes.length > 0 && fineBiPickupConn
          ? fetchFineBiMetrics({
              endDate: yesterday.format('YYYY-MM-DD'),
              vendorCodes,
              stationCodes: selectedStations,
              fineBiConnection: toFineBiConnectionInput(fineBiPickupConn),
            }, signal)
          : Promise.resolve({ ok: true as const, data: {} }),
        vendorCodes.length > 0 && fineBi24hConn
          ? fetchFineBi24hDispatchMetrics({
              startDate: fineBi24hStartDate,
              endDate: fineBi24hEndDate,
              vendorCodes,
              stationCodes: selectedStations,
              fineBiConnection: toFineBiConnectionInput(fineBi24hConn),
            }, signal)
          : Promise.resolve({ ok: true as const, data: {} }),
        fetchDriverWaybills(imileToken, { startTime: yesterdayStartTime, endTime: yesterdayEndTime }, signal),
        fetchDriverWaybills(imileToken, { startTime: dayBeforeStartTime, endTime: dayBeforeEndTime }, signal),
        fetchDriverReturnWarning(imileToken, { stationCodes: selectedStations }, signal),
      ])
    } catch (err) {
      setDataFetching(false)
      if (err instanceof Error && err.name === 'AbortError') return
      showToast('数据获取失败，请重试', 'error')
      return
    }

    setDataFetching(false)

    if (
      !ticketsRes.ok ||
      !waybillsRes.ok ||
      !unprocessedRes.ok ||
      !longTailRes.ok ||
      !fineBiPickupRes.ok ||
      !fineBi24hRes.ok ||
      !driverYesterdayRes.ok ||
      !driverDayBeforeRes.ok ||
      !driverReturnRes.ok
    ) {
      const errMsg = !ticketsRes.ok
        ? ticketsRes.error
        : !waybillsRes.ok
          ? waybillsRes.error
          : !unprocessedRes.ok
            ? unprocessedRes.error
            : !longTailRes.ok
              ? longTailRes.error
              : !fineBiPickupRes.ok
                ? fineBiPickupRes.error
                : !fineBi24hRes.ok
                  ? fineBi24hRes.error
                  : !driverYesterdayRes.ok
                    ? driverYesterdayRes.error
                    : !driverDayBeforeRes.ok
                      ? driverDayBeforeRes.error
                      : !driverReturnRes.ok
                        ? driverReturnRes.error
                        : '未知错误'
      showToast(`数据获取失败: ${errMsg}`, 'error')
      return
    }

    const unprocessedTotal =
      unprocessedRes.data.normalTickets.length +
      unprocessedRes.data.complaintTickets.length +
      unprocessedRes.data.arbitrationTickets.length

    setFetchedData({
      tickets: ticketsRes.data as ComplaintTicketRow[],
      waybills: waybillsRes.data as WaybillRow[],
      unprocessedTickets: unprocessedRes.data,
      longTailOrders: longTailRes.data,
      fineBiMetricsByVendor: fineBiPickupRes.data,
      fineBi24hMetricsByVendor: fineBi24hRes.data,
      driverYesterdayWaybills: driverYesterdayRes.data,
      driverDayBeforeWaybills: driverDayBeforeRes.data,
      driverReturnRows: driverReturnRes.data,
      fetchedAt: new Date(),
      startTime,
      endTime,
      ticketStartTime,
      ticketEndTime,
      fineBiPickupEndTime: yesterday.format('YYYY-MM-DD'),
      fineBi24hStartTime: dayBeforeStartTime,
      fineBi24hEndTime: dayBeforeEndTime,
    })
    const fineBiPickupCount = Object.keys(fineBiPickupRes.data).length
    const fineBi24hCount = Object.keys(fineBi24hRes.data).length
    showToast(
      `数据获取成功：${waybillsRes.data.length} 条运单 · ${ticketsRes.data.length} 条客诉 · ${unprocessedTotal} 条未处理工单 · ${longTailRes.data.length} 条长尾单 · FineBI 出仓率 ${fineBiPickupCount} 家 · 24h签派率 ${fineBi24hCount} 家`,
      'success',
    )
  }, [dateRange, complaintDateRange, imileToken, selectedStations, configs, fineBiConnections])

  const indexedData = useMemo(() => {
    if (!fetchedData) return null
    const stationSet = new Set(selectedStations)

    const waybillsByVendor = new Map<string, WaybillRow[]>()
    for (const w of fetchedData.waybills) {
      const key = w.courierVendorCode ?? ''
      let arr = waybillsByVendor.get(key)
      if (!arr) { arr = []; waybillsByVendor.set(key, arr) }
      arr.push(w)
    }

    const ticketsByVendor = new Map<string, ComplaintTicketRow[]>()
    for (const t of fetchedData.tickets) {
      if (stationSet.size > 0 && !stationSet.has(t.relatedResponsibleHubCode ?? '')) continue
      const key = t.responsibleDeptCode ?? ''
      let arr = ticketsByVendor.get(key)
      if (!arr) { arr = []; ticketsByVendor.set(key, arr) }
      arr.push(t)
    }

    const longTailByVendor = new Map<string, LongTailOrderRow[]>()
    for (const o of fetchedData.longTailOrders) {
      const key = o.driverVendorCode ?? ''
      let arr = longTailByVendor.get(key)
      if (!arr) { arr = []; longTailByVendor.set(key, arr) }
      arr.push(o)
    }

    const unprocessedCountByVendor = new Map<string, number>()
    const { normalTickets, complaintTickets, arbitrationTickets } = fetchedData.unprocessedTickets
    for (const t of normalTickets) {
      const row = t as NormalUnprocessedTicketRow
      if (stationSet.size > 0 && !stationSet.has(row.currentHandleStationCode ?? '')) continue
      const key = row.currentHandleCode ?? ''
      unprocessedCountByVendor.set(key, (unprocessedCountByVendor.get(key) ?? 0) + 1)
    }
    for (const t of [...complaintTickets, ...arbitrationTickets]) {
      const row = t as HubUnprocessedTicketRow
      if (stationSet.size > 0 && !stationSet.has(row.relatedResponsibleHubCode ?? '')) continue
      const key = row.responsibleDeptCode ?? ''
      unprocessedCountByVendor.set(key, (unprocessedCountByVendor.get(key) ?? 0) + 1)
    }

    return { waybillsByVendor, ticketsByVendor, longTailByVendor, unprocessedCountByVendor, stationSet }
  }, [fetchedData, selectedStations])

  const pushAll = useCallback(async () => {
    if (!fetchedData || !indexedData) { showToast('请先点击「获取数据」', 'error'); return }
    if (selectedStations.length === 0) { showToast('请先选择责任站点', 'error'); return }

    const enabledConfigs = configs.filter((c) => !c.isDisabled && c.webhookUrl.trim())
    if (enabledConfigs.length === 0) {
      showToast('没有可用的推送配置（已全部禁用或缺少 Webhook 地址）', 'error')
      return
    }

    setIsPushingAll(true)

    const { waybillsByVendor, ticketsByVendor, longTailByVendor, unprocessedCountByVendor } = indexedData
    const fmt = (s: string) => s.slice(5, 10).replace('-', '/')
    const dateLabel = `${fmt(fetchedData.startTime)}—${fmt(fetchedData.endTime)}`
    const ticketDateLabel = `${fmt(fetchedData.ticketStartTime)}—${fmt(fetchedData.ticketEndTime)}`
    const stationLabel = selectedStations.join('、')

    let successCount = 0
    let failCount = 0

    for (const config of enabledConfigs) {
      const complaintCount = ticketsByVendor.get(config.vendorCode)?.length ?? 0
      const waybillCount = waybillsByVendor.get(config.vendorCode)?.length ?? 0
      const complaintRate = waybillCount > 0 ? complaintCount / waybillCount : 0
      const ratePercent = (complaintRate * 100).toFixed(2)

      const unprocessedTicketCount = unprocessedCountByVendor.get(config.vendorCode) ?? 0
      const longTailCount = longTailByVendor.get(config.vendorCode)?.length ?? 0
      const fineBi = fetchedData.fineBiMetricsByVendor[config.vendorCode]
      const fineBi24h = fetchedData.fineBi24hMetricsByVendor[config.vendorCode]
      const before11ExitRate = fineBi?.before11ExitRate ?? null
      const before11ExitPercent = before11ExitRate != null
        ? (before11ExitRate * 100).toFixed(2)
        : '—'
      const dispatchRate24hText = fineBi24h?.dispatchRate24hText ?? null
      const notMet24hSignCount = fineBi24h?.notMet24hSignCount ?? null

      const card = buildVendorFeishuCard({
        vendorName: config.vendorName,
        dateLabel,
        ticketDateLabel,
        stationLabel,
        complaintCount,
        waybillCount,
        ratePercent,
        before11ExitPercent,
        dispatchRate24hText,
        notMet24hSignCount,
        unprocessedTicketCount,
        longTailCount,
        pushDescription: config.pushDescription ?? '',
      })

      const res = await postFeishuPushCard({
        pushScope: 'vendor-analysis',
        webhookUrl: config.webhookUrl,
        signingSecret: config.signingSecret ?? undefined,
        card,
      })

      if (res.ok) {
        successCount++
      } else {
        failCount++
        const errMsg = 'error' in res ? res.error : '未知错误'
        console.warn(`[vendor-push] 「${config.vendorName}」推送失败: ${errMsg}`)
      }
    }

    setIsPushingAll(false)

    if (failCount === 0) {
      showToast(`全部 ${successCount} 个配置已成功推送至飞书群`, 'success')
    } else if (successCount === 0) {
      showToast(`推送失败，共 ${failCount} 个配置发送异常`, 'error')
    } else {
      showToast(`推送完成：${successCount} 成功 · ${failCount} 失败`, 'warning')
    }
  }, [fetchedData, indexedData, selectedStations, configs, dateRange])

  const addConfig = useCallback(async (draft: VendorPushConfigDraft) => {
    const res = await createConfig(draft)
    if (!res.ok) { showToast(`新增失败: ${res.error}`, 'error'); return false }
    setConfigs((prev) => [...prev, res.data])
    showToast(`已添加「${res.data.vendorName}」推送配置`, 'success')
    return true
  }, [])

  const editConfig = useCallback(async (id: string, draft: VendorPushConfigDraft) => {
    const res = await updateConfig(id, draft)
    if (!res.ok) { showToast(`更新失败: ${res.error}`, 'error'); return false }
    setConfigs((prev) => prev.map((c) => (c.id === id ? res.data : c)))
    showToast(`已更新「${res.data.vendorName}」推送配置`, 'success')
    return true
  }, [])

  const removeConfig = useCallback(async (id: string, vendorName: string) => {
    const res = await deleteConfig(id)
    if (!res.ok) { showToast(`删除失败: ${res.error}`, 'error'); return }
    setConfigs((prev) => prev.filter((c) => c.id !== id))
    showToast(`已删除「${vendorName}」推送配置`, 'success')
  }, [])

  const toggleDisabled = useCallback(async (id: string, nextDisabled: boolean) => {
    const config = configs.find((c) => c.id === id)
    if (!config) return
    const res = await updateConfig(id, {
      vendorCode: config.vendorCode,
      vendorName: config.vendorName,
      webhookUrl: config.webhookUrl,
      signingSecret: config.signingSecret,
      pushDescription: config.pushDescription,
      isDisabled: nextDisabled,
    })
    if (!res.ok) { showToast(`操作失败: ${res.error}`, 'error'); return }
    setConfigs((prev) => prev.map((c) => (c.id === id ? res.data : c)))
    showToast(`已${nextDisabled ? '禁用' : '启用'}「${config.vendorName}」推送配置`, 'success')
  }, [configs])

  const driverPerformanceByVendor = useMemo<Record<string, DriverPerformanceRow[]>>(() => {
    if (!fetchedData) return {}

    // ── 归班预警：当日14:00为基准，ofdDate距基准>=48h 则计入 ──
    const cutoff = new Date()
    cutoff.setHours(14, 0, 0, 0)
    const cutoffMs = cutoff.getTime()

    const returnWarningMap = new Map<string, number>()
    for (const row of fetchedData.driverReturnRows) {
      if (!row.driverCode || !row.ofdDate) continue
      if (cutoffMs - new Date(row.ofdDate).getTime() >= 48 * 60 * 60 * 1000) {
        returnWarningMap.set(row.driverCode, (returnWarningMap.get(row.driverCode) ?? 0) + 1)
      }
    }

    const result: Record<string, DriverPerformanceRow[]> = {}

    for (const config of configs) {
      // ── 今日取件量：昨日运单，按 courierVendorCode 匹配，按 courierCode 计数 ──
      type PickupAgg = { courierName: string; routeCode: string; count: number }
      const pickupMap = new Map<string, PickupAgg>()
      for (const row of fetchedData.driverYesterdayWaybills) {
        if (!row.courierCode || row.courierVendorCode !== config.vendorCode) continue
        const agg = pickupMap.get(row.courierCode)
        if (agg) {
          agg.count += 1
        } else {
          pickupMap.set(row.courierCode, {
            courierName: row.courier ?? '',
            routeCode: row.consigneeRouteCode ?? '',
            count: 1,
          })
        }
      }

      // ── 24H派签率：前天运单，按 courierVendorCode 匹配，按规则判断是否达标 ──
      type DispatchAgg = { total: number; completed: number; routeCode: string }
      const dispatchMap = new Map<string, DispatchAgg>()
      for (const row of fetchedData.driverDayBeforeWaybills) {
        if (!row.courierCode || row.courierVendorCode !== config.vendorCode) continue
        if (!row.deliveryTime) continue

        const deliveryMs = new Date(row.deliveryTime).getTime()
        const signMs = row.signDate ? new Date(row.signDate).getTime() : null
        const dow = new Date(row.deliveryTime).getDay() // 0=Sun,1=Mon,...,6=Sat

        let completed = false
        if (dow <= 4) {
          // 周日~周四：签收时间 - 派件时间 <= 24h
          completed = signMs != null && signMs - deliveryMs <= 24 * 60 * 60 * 1000
        } else {
          // 周五、周六：下周一 23:59:59 前签收即达标
          const daysToMonday = dow === 5 ? 3 : 2
          const nextMonday = new Date(row.deliveryTime)
          nextMonday.setDate(nextMonday.getDate() + daysToMonday)
          nextMonday.setHours(23, 59, 59, 0)
          completed = signMs != null && signMs <= nextMonday.getTime()
        }

        const agg = dispatchMap.get(row.courierCode)
        if (agg) {
          agg.total += 1
          if (completed) agg.completed += 1
        } else {
          dispatchMap.set(row.courierCode, { total: 1, completed: completed ? 1 : 0, routeCode: row.consigneeRouteCode ?? '' })
        }
      }

      // ── 合并所有司机（取件量 + 24H派签 + 归班预警 三个来源） ──
      const allCourierCodes = new Set([
        ...pickupMap.keys(),
        ...dispatchMap.keys(),
        ...[...returnWarningMap.keys()].filter((code) => {
          const returnRow = fetchedData.driverReturnRows.find(
            (r) => r.driverCode === code && r.driverVendorCode === config.vendorCode,
          )
          return !!returnRow
        }),
      ])

      const drivers: DriverPerformanceRow[] = []
      for (const courierCode of allCourierCodes) {
        const pickup = pickupMap.get(courierCode)
        const dispatch = dispatchMap.get(courierCode)

        let courierName = pickup?.courierName ?? ''
        if (!courierName) {
          const dispatchRow = fetchedData.driverDayBeforeWaybills.find(
            (r) => r.courierCode === courierCode && r.courierVendorCode === config.vendorCode,
          )
          courierName = dispatchRow?.courier ?? ''
        }
        if (!courierName) {
          const returnRow = fetchedData.driverReturnRows.find(
            (r) => r.driverCode === courierCode && r.driverVendorCode === config.vendorCode,
          )
          courierName = returnRow?.driverName ?? courierCode
        }

        const totalDispatch = dispatch?.total ?? 0
        const dispatch24hCount = dispatch?.completed ?? 0
        const dispatchRate24h = totalDispatch > 0 ? dispatch24hCount / totalDispatch : null

        drivers.push({
          courierCode,
          courierName,
          vendorCode: config.vendorCode,
          vendorName: config.vendorName,
          routeCode: pickup?.routeCode || dispatch?.routeCode || '',
          ofdCount: pickup?.count ?? 0,
          returnWarningCount: returnWarningMap.get(courierCode) ?? 0,
          dispatch24hCount,
          totalDispatchCount: totalDispatch,
          dispatchRate24h,
        })
      }

      drivers.sort((a, b) => b.returnWarningCount - a.returnWarningCount || b.ofdCount - a.ofdCount)
      result[config.vendorCode] = drivers
    }

    return result
  }, [fetchedData, configs])

  const vendorMetrics = useMemo<VendorMetricRow[]>(() => {
    if (!fetchedData || !indexedData) return []
    const { waybillsByVendor, ticketsByVendor, longTailByVendor, unprocessedCountByVendor } = indexedData
    return configs.map((config) => {
      const complaintCount = ticketsByVendor.get(config.vendorCode)?.length ?? 0
      const waybillCount = waybillsByVendor.get(config.vendorCode)?.length ?? 0
      const complaintRate = waybillCount > 0 ? complaintCount / waybillCount : 0
      const unprocessedTicketCount = unprocessedCountByVendor.get(config.vendorCode) ?? 0
      const longTailCount = longTailByVendor.get(config.vendorCode)?.length ?? 0
      const fineBi = fetchedData.fineBiMetricsByVendor[config.vendorCode]
      const fineBi24h = fetchedData.fineBi24hMetricsByVendor[config.vendorCode]
      return {
        vendorCode: config.vendorCode,
        vendorName: config.vendorName,
        complaintCount,
        waybillCount,
        complaintRate,
        unprocessedTicketCount,
        longTailCount,
        before11ExitRate: fineBi?.before11ExitRate ?? null,
        dispatchRate24hText: fineBi24h?.dispatchRate24hText ?? null,
        notMet24hSignCount: fineBi24h?.notMet24hSignCount ?? null,
        isDisabled: config.isDisabled,
      }
    })
  }, [fetchedData, indexedData, configs])

  return {
    dateRange,
    setDateRange: handleDateRangeChange,
    complaintDateRange,
    setComplaintDateRange: handleComplaintDateRangeChange,
    selectedStations,
    fineBiConnections,
    setFineBiConnections: handleFineBiConnectionsChange,
    vendors,
    vendorsLoading,
    configs,
    configsLoading,
    fetchedData,
    dataFetching,
    fetchData,
    isPushingAll,
    pushAll,
    addConfig,
    editConfig,
    removeConfig,
    toggleDisabled,
    vendorMetrics,
    driverPerformanceByVendor,
  }
}

function metricColumn(label: string, content: string): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: `${label}\n${content}` } }],
  }
}

function buildVendorFeishuCard(params: {
  vendorName: string
  dateLabel: string
  ticketDateLabel: string
  stationLabel: string
  complaintCount: number
  waybillCount: number
  ratePercent: string
  before11ExitPercent: string
  dispatchRate24hText: string | null
  notMet24hSignCount: number | null
  unprocessedTicketCount: number
  longTailCount: number
  pushDescription: string
}): Record<string, unknown> {
  const {
    vendorName, dateLabel, ticketDateLabel, stationLabel,
    complaintCount, waybillCount, ratePercent, before11ExitPercent,
    dispatchRate24hText, notMet24hSignCount,
    unprocessedTicketCount, longTailCount, pushDescription,
  } = params

  const rateNum = parseFloat(ratePercent)
  const headerTemplate = rateNum >= 3 ? 'red' : rateNum >= 1 ? 'orange' : 'blue'
  const rateColor = rateNum >= 3 ? 'red' : rateNum >= 1 ? 'orange' : 'green'
  const before11Num = before11ExitPercent === '—' ? null : parseFloat(before11ExitPercent)
  const before11Color = before11Num == null
    ? 'grey'
    : before11Num >= 98
      ? 'green'
      : before11Num >= 95
        ? 'orange'
        : 'red'
  const dispatch24hColor = dispatchRate24hColor(dispatchRate24hText)
  const dispatch24hDisplay = dispatchRate24hText ?? '—'
  const notMet24hDisplay = notMet24hSignCount == null ? '—' : String(notMet24hSignCount)
  const pendingColor = (n: number) => n > 0 ? 'orange' : 'green'

  const dateLine = ticketDateLabel !== dateLabel
    ? `📅 应揽量 ${dateLabel} · 客诉统计 ${ticketDateLabel}`
    : `📅 ${dateLabel}`

  const footerElements: Record<string, unknown>[] = pushDescription
    ? [{ tag: 'hr' }, { tag: 'note', elements: [{ tag: 'plain_text', content: pushDescription }] }]
    : []

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: vendorName },
      subtitle: { tag: 'plain_text', content: '供应商数据分析报告' },
      template: headerTemplate,
    },
    body: {
      direction: 'vertical',
      elements: [
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `${dateLine}\n📍 ${stationLabel}` },
        },
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: '**核心指标**' } },
        {
          tag: 'column_set',
          flex_mode: 'none',
          background_style: 'grey',
          columns: [
            metricColumn(
              '客诉率',
              `<font color='${rateColor}'>**${ratePercent}%**</font>\n客诉量 ${complaintCount} 件 · 揽收量 ${waybillCount} 件`,
            ),
            metricColumn(
              '11点前出仓率',
              `<font color='${before11Color}'>**${before11ExitPercent}${before11ExitPercent === '—' ? '' : '%'}**</font>`,
            ),
            metricColumn(
              '24小时签派率',
              `<font color='${dispatch24hColor}'>**${dispatch24hDisplay}**</font>`,
            ),
            metricColumn(
              FINEBI_METRIC_NOT_MET_24H_LABEL,
              `<font color='${notMet24hSignCount != null && notMet24hSignCount > 0 ? 'orange' : 'green'}'>**${notMet24hDisplay}**</font>${notMet24hSignCount != null ? ' 件' : ''}`,
            ),
          ],
        },
        { tag: 'div', text: { tag: 'lark_md', content: '**待处理事项**' } },
        {
          tag: 'column_set',
          flex_mode: 'none',
          background_style: 'grey',
          columns: [
            metricColumn('未处理工单', `<font color='${pendingColor(unprocessedTicketCount)}'>**${unprocessedTicketCount}**</font> 件`),
            metricColumn('长尾单', `<font color='${pendingColor(longTailCount)}'>**${longTailCount}**</font> 件`),
          ],
        },
        ...footerElements,
      ],
    },
  }
}
