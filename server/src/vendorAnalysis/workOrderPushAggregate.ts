/**
 * 工单推送——把「未处理工单」原始行（普通/客诉/仲裁三类）按解析出的供应商归属分组聚合。
 * 供应商归属来自 waybillNo → courierVendorCode（见 imile/workOrderPushWaybills.ts），
 * 不用工单自带的 currentHandleCode/responsibleDeptCode（那是内部处理部门/责任人代码，未处理工单常常还没分配）。
 */

export type WorkOrderTicketType = 'normal' | 'complaint' | 'arbitration'

export type WorkOrderPushTicketDetail = {
  type: WorkOrderTicketType
  orderCode: string
  waybillNo: string
  /** 最晚处理时间，原样透传 iMile 返回的字符串（可能为空） */
  expectHandleTime: string
}

export type WorkOrderPushVendorSummary = {
  vendorCode: string
  normalCount: number
  complaintCount: number
  arbitrationCount: number
  totalCount: number
  tickets: WorkOrderPushTicketDetail[]
}

export type WorkOrderPushAggregateResult = {
  byVendor: Map<string, WorkOrderPushVendorSummary>
  /** waybillNo 缺失或 searchWaybill 未查到供应商归属的工单数，仅用于日志可见性，不静默丢弃 */
  unmatchedCount: number
}

type TicketRow = {
  waybillNo?: unknown
  orderCode?: unknown
  expectHandleTime?: unknown
}

function readTicketDetail(row: unknown, type: WorkOrderTicketType): WorkOrderPushTicketDetail | null {
  if (!row || typeof row !== 'object') return null
  const t = row as TicketRow
  const waybillNo = typeof t.waybillNo === 'string' ? t.waybillNo.trim() : ''
  if (!waybillNo) return null
  const orderCode = typeof t.orderCode === 'string' ? t.orderCode : String(t.orderCode ?? '')
  const expectHandleTime = typeof t.expectHandleTime === 'string' ? t.expectHandleTime : ''
  return { type, orderCode, waybillNo, expectHandleTime }
}

function getOrCreateSummary(
  byVendor: Map<string, WorkOrderPushVendorSummary>,
  vendorCode: string,
): WorkOrderPushVendorSummary {
  let summary = byVendor.get(vendorCode)
  if (!summary) {
    summary = {
      vendorCode,
      normalCount: 0,
      complaintCount: 0,
      arbitrationCount: 0,
      totalCount: 0,
      tickets: [],
    }
    byVendor.set(vendorCode, summary)
  }
  return summary
}

export function aggregateWorkOrderPush(input: {
  normalTickets: unknown[]
  complaintTickets: unknown[]
  arbitrationTickets: unknown[]
  /** waybillNo -> courierVendorCode，来自 fetchWorkOrderWaybillVendors */
  waybillVendorMap: Map<string, string>
}): WorkOrderPushAggregateResult {
  const byVendor = new Map<string, WorkOrderPushVendorSummary>()
  let unmatchedCount = 0

  const groups: Array<{ rows: unknown[]; type: WorkOrderTicketType }> = [
    { rows: input.normalTickets, type: 'normal' },
    { rows: input.complaintTickets, type: 'complaint' },
    { rows: input.arbitrationTickets, type: 'arbitration' },
  ]

  for (const { rows, type } of groups) {
    for (const row of rows) {
      const detail = readTicketDetail(row, type)
      if (!detail) {
        unmatchedCount += 1
        continue
      }
      const vendorCode = input.waybillVendorMap.get(detail.waybillNo)
      if (!vendorCode) {
        unmatchedCount += 1
        continue
      }
      const summary = getOrCreateSummary(byVendor, vendorCode)
      summary.tickets.push(detail)
      summary.totalCount += 1
      if (type === 'normal') summary.normalCount += 1
      else if (type === 'complaint') summary.complaintCount += 1
      else summary.arbitrationCount += 1
    }
  }

  return { byVendor, unmatchedCount }
}
