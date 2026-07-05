/**
 * 供应商数据分析——worker 落库的「汇总结果」类型（前端侧）。
 *
 * 与后端 server/src/vendorAnalysis/aggregate.ts 的 VendorSummary / DriverSummary /
 * VendorAnalyzeSummary 逐字段对应（字符串契约，参照 metricsCatalog 前后端各一份的既有约定）。
 * 前端不再持有原始明细，直接读这份汇总渲染/推送；供应商名称/昵称/配置 id 由前端按 vendorCode join。
 */

export type DriverSummary = {
  courierCode: string
  courierName: string
  routeCode: string
  ofdCount: number
  ofdWaybillNos: string[]
  before11OfdCount: number
  before11UnmetWaybillNos: string[]
  returnWarningCount: number
  returnWarningWaybillNos: string[]
  dispatch24hCount: number
  totalDispatchCount: number
  dispatchRate24h: number | null
  dispatch24hUnmetWaybillNos: string[]
  longTailCount: number
  longTailWaybillNos: string[]
}

export type VendorSummary = {
  vendorCode: string
  complaintCount: number
  waybillCount: number
  complaintRate: number
  complaintOrderCodes: string[]
  unprocessedTicketCount: number
  unprocessedTicketOrderCodes: string[]
  longTailCount: number
  before11ExitRate: number | null
  before11ExitVolume: number | null
  before11TotalReceived: number | null
  before11UnmetWaybillNos: string[]
  dispatchRate24hText: string | null
  notMet24hSignCount: number | null
  dispatch24hTotal: number | null
  dispatch24hCount: number | null
  dispatch24hUnmetWaybillNos: string[]
  drivers: DriverSummary[]
}

export type VendorAnalyzeSummary = {
  schemaVersion: 2
  referenceDate: string
  /** 本次任务实际抓取的数据源 */
  dataSources: string[]
  /** 任务创建时冻结的责任站点口径 */
  stationCodes: string[]
  startTime: string
  endTime: string
  ticketStartTime: string
  ticketEndTime: string
  /** 11点前出仓率数据日期：昨天 */
  before11Date: string
  /** 24小时派签率数据日期：参考日期的前天 */
  dayBeforeDate: string
  /** worker 完成时刻（ISO），归班预警 48h 的基准 */
  computedAt: string
  vendors: VendorSummary[]
}
