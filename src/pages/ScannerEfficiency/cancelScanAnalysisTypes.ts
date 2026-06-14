import type { RouteCodeDistributionItem } from './scannerEfficiencyApi'

export type DailyRouteCodeCount = {
  date: string
  routeCode: string
  count: number
}

export type CancelScanAnalysisState = {
  dateRange: string
  routeCodeDistribution: RouteCodeDistributionItem[]
  /** 按日 × 路由码明细（日期来自 cancelScan.scanDate），用于错误分配过滤 */
  dailyRouteCodeCounts?: DailyRouteCodeCount[]
  meta: {
    startDate: string
    endDate: string
    cancelScanTotal: number
    cancelScanFetched: number
    waybillCount: number
    waybillFetched: number
  }
}
