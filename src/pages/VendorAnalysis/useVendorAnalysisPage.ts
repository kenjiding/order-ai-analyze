import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dayjs } from 'dayjs'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { postFeishuPushCard } from '../PushNotifications/feishuWebhookTestApi'
import type {
  ComplaintTicketRow,
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
  fetchLongTailOrders,
  fetchUnprocessedTickets,
  fetchVendors,
  fetchWaybills,
  loadConfigs,
  updateConfig,
} from './vendorAnalysisApi'

export type FetchedData = {
  tickets: ComplaintTicketRow[]
  waybills: WaybillRow[]
  unprocessedTickets: UnprocessedTicketsData
  longTailOrders: LongTailOrderRow[]
  fetchedAt: Date
  startTime: string
  endTime: string
  ticketStartTime: string
  ticketEndTime: string
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

  const fetchData = useCallback(async () => {
    if (!dateRange) { showToast('请先选择时间范围', 'error'); return }

    const startTime = dateRange[0].format('YYYY-MM-DD 00:00:00')
    const endTime = dateRange[1].format('YYYY-MM-DD 23:59:59')

    const effectiveTicketRange = complaintDateRange ?? dateRange
    const ticketStartTime = effectiveTicketRange[0].format('YYYY-MM-DD 00:00:00')
    const ticketEndTime = effectiveTicketRange[1].format('YYYY-MM-DD 23:59:59')

    setDataFetching(true)
    setFetchedData(null)

    const [ticketsRes, waybillsRes, unprocessedRes, longTailRes] = await Promise.all([
      fetchComplaintTickets(imileToken, { startTime: ticketStartTime, endTime: ticketEndTime }),
      fetchWaybills(imileToken, { startTime, endTime }),
      fetchUnprocessedTickets(imileToken, { startTime: ticketStartTime, endTime: ticketEndTime }),
      fetchLongTailOrders(imileToken, { stationCodes: selectedStations }),
    ])

    setDataFetching(false)

    if (!ticketsRes.ok || !waybillsRes.ok || !unprocessedRes.ok || !longTailRes.ok) {
      const errMsg = !ticketsRes.ok
        ? ticketsRes.error
        : !waybillsRes.ok
          ? waybillsRes.error
          : !unprocessedRes.ok
            ? unprocessedRes.error
            : (longTailRes as { ok: false; error: string }).error
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
      fetchedAt: new Date(),
      startTime,
      endTime,
      ticketStartTime,
      ticketEndTime,
    })
    showToast(
      `数据获取成功：${waybillsRes.data.length} 条运单 · ${ticketsRes.data.length} 条客诉 · ${unprocessedTotal} 条未处理工单 · ${longTailRes.data.length} 条长尾单`,
      'success',
    )
  }, [dateRange, complaintDateRange, imileToken, selectedStations])

  const pushAll = useCallback(async () => {
    if (!fetchedData) { showToast('请先点击「获取数据」', 'error'); return }
    if (selectedStations.length === 0) { showToast('请先选择责任站点', 'error'); return }

    const enabledConfigs = configs.filter((c) => !c.isDisabled && c.webhookUrl.trim())
    if (enabledConfigs.length === 0) {
      showToast('没有可用的推送配置（已全部禁用或缺少 Webhook 地址）', 'error')
      return
    }

    setIsPushingAll(true)

    const stationSet = new Set(selectedStations)
    const fmt = (s: string) => s.slice(5, 10).replace('-', '/')
    const dateLabel = `${fmt(fetchedData.startTime)}—${fmt(fetchedData.endTime)}`
    const ticketDateLabel = `${fmt(fetchedData.ticketStartTime)}—${fmt(fetchedData.ticketEndTime)}`
    const stationLabel = selectedStations.join('、')

    let successCount = 0
    let failCount = 0

    for (const config of enabledConfigs) {
      const filteredTickets = fetchedData.tickets.filter(
        (t) =>
          stationSet.has(t.relatedResponsibleHubCode ?? '') &&
          t.responsibleDeptCode === config.vendorCode,
      )
      const filteredWaybills = fetchedData.waybills.filter(
        (w) => w.courierVendorCode === config.vendorCode,
      )

      const complaintCount = filteredTickets.length
      const waybillCount = filteredWaybills.length
      const complaintRate = waybillCount > 0 ? complaintCount / waybillCount : 0
      const ratePercent = (complaintRate * 100).toFixed(2)

      const unprocessedTicketCount = countUnprocessedTickets(
        fetchedData.unprocessedTickets,
        stationSet,
        config.vendorCode,
      )
      const longTailCount = fetchedData.longTailOrders.filter(
        (o) => o.driverVendorCode === config.vendorCode,
      ).length

      const card = buildVendorFeishuCard({
        vendorName: config.vendorName,
        dateLabel,
        ticketDateLabel,
        stationLabel,
        complaintCount,
        waybillCount,
        ratePercent,
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
  }, [fetchedData, selectedStations, configs, dateRange])

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

  const vendorMetrics = useMemo<VendorMetricRow[]>(() => {
    if (!fetchedData) return []
    const stationSet = new Set(selectedStations)
    return configs.map((config) => {
      const filteredTickets = fetchedData.tickets.filter(
        (t) =>
          (stationSet.size === 0 || stationSet.has(t.relatedResponsibleHubCode ?? '')) &&
          t.responsibleDeptCode === config.vendorCode,
      )
      const filteredWaybills = fetchedData.waybills.filter(
        (w) => w.courierVendorCode === config.vendorCode,
      )
      const complaintCount = filteredTickets.length
      const waybillCount = filteredWaybills.length
      const complaintRate = waybillCount > 0 ? complaintCount / waybillCount : 0
      const unprocessedTicketCount = countUnprocessedTickets(
        fetchedData.unprocessedTickets,
        stationSet,
        config.vendorCode,
      )
      const longTailCount = fetchedData.longTailOrders.filter(
        (o) => o.driverVendorCode === config.vendorCode,
      ).length
      return { vendorCode: config.vendorCode, vendorName: config.vendorName, complaintCount, waybillCount, complaintRate, unprocessedTicketCount, longTailCount, isDisabled: config.isDisabled }
    })
  }, [fetchedData, configs, selectedStations])

  return {
    dateRange,
    setDateRange: handleDateRangeChange,
    complaintDateRange,
    setComplaintDateRange: handleComplaintDateRangeChange,
    selectedStations,
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
  }
}

function countUnprocessedTickets(
  data: UnprocessedTicketsData,
  stationSet: Set<string>,
  vendorCode: string,
): number {
  const normalCount = data.normalTickets.filter(
    (t) => {
      const row = t as NormalUnprocessedTicketRow
      return (stationSet.size === 0 || stationSet.has(row.currentHandleStationCode ?? '')) &&
        row.currentHandleCode === vendorCode
    },
  ).length

  const complaintCount = data.complaintTickets.filter(
    (t) => {
      const row = t as HubUnprocessedTicketRow
      return (stationSet.size === 0 || stationSet.has(row.relatedResponsibleHubCode ?? '')) &&
        row.responsibleDeptCode === vendorCode
    },
  ).length

  const arbitrationCount = data.arbitrationTickets.filter(
    (t) => {
      const row = t as HubUnprocessedTicketRow
      return (stationSet.size === 0 || stationSet.has(row.relatedResponsibleHubCode ?? '')) &&
        row.responsibleDeptCode === vendorCode
    },
  ).length

  return normalCount + complaintCount + arbitrationCount
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
  unprocessedTicketCount: number
  longTailCount: number
  pushDescription: string
}): Record<string, unknown> {
  const {
    vendorName, dateLabel, ticketDateLabel, stationLabel,
    complaintCount, waybillCount, ratePercent,
    unprocessedTicketCount, longTailCount, pushDescription,
  } = params

  const rateNum = parseFloat(ratePercent)
  const headerTemplate = rateNum >= 3 ? 'red' : rateNum >= 1 ? 'orange' : 'blue'
  const rateColor = rateNum >= 3 ? 'red' : rateNum >= 1 ? 'orange' : 'green'
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
