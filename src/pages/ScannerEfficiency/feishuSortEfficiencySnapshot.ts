import type { AttendanceEfficiencyResult, ScannerEfficiencyResult } from './aggregates'

/** 与后端 `sortEfficiencyFeishuAnalysis` 约定一致，供飞书推送前 DeepSeek 解读 */
export type FeishuSortEfficiencyDataSnapshot = {
  kind: 'sort_efficiency_v1'
  /** 如「2026年5月1日～2026年5月7日」 */
  periodLabel: string
  /** 一级分拣（扫描）口径；飞书 AI 点评须称「一级分拣效率」，勿与 warehouseAttendance 混称 */
  sorting: {
    summary: {
      totalScanCount: number
      totalEffectiveHours: number
      /** 一级分拣综合效率（票/时），分母为分拣有效工时 */
      totalEfficiency: number
      totalDays: number
      totalScanners: number
    }
    daily: Array<{
      date: string
      scanCount: number
      efficiency: number
      effectiveHours: number
      scannerCount: number
    }>
    topScanners: Array<{
      scanner: string
      scanCount: number
      /** 与页面表格/图表一致：修正效率（票/小时） */
      adjustedEfficiency: number
      /** 原始效率（票/小时），仅作参考 */
      rawEfficiency: number
      activeDays: number
    }>
  }
  /** 全仓考勤口径；飞书 AI 点评 overallEfficiency 须称「总效率」，openEfficiency 称「开仓效率」 */
  warehouseAttendance?: {
    uploadedVolume: number
    /** 开仓效率（票/时） */
    openEfficiency: number
    /** 总效率 / 总体效率（票/时），分母为全部考勤工时 */
    overallEfficiency: number
    openHours: number
    allHours: number
    openDayCount: number
    matchedDayCount: number
  }
}

/** 点击「飞书推送图表」后按本地日历日写入 IndexedDB；同一 dateKey 多次推送覆盖为最新一条 */
export type SortEfficiencyPushDayRecord = {
  /** 本地日期 YYYY-MM-DD */
  dateKey: string
  savedAt: string
  periodLabel: string
  snapshot: FeishuSortEfficiencyDataSnapshot
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function buildFeishuSortEfficiencyDataSnapshot(options: {
  periodLabel: string
  scannerResult: ScannerEfficiencyResult | null
  attendanceResult: AttendanceEfficiencyResult | null
}): FeishuSortEfficiencyDataSnapshot | null {
  const { periodLabel, scannerResult, attendanceResult } = options
  if (!scannerResult) return null

  const daily = scannerResult.dailySummaryRows.map((row) => ({
    date: row.date,
    scanCount: row.scanCount,
    efficiency: round2(row.efficiency),
    effectiveHours: round4(row.effectiveHours),
    scannerCount: row.scannerCount,
  }))

  const topScanners = scannerResult.scannerTotalRows.slice(0, 12).map((row) => ({
    scanner: row.scanner,
    scanCount: row.scanCount,
    adjustedEfficiency: round2(row.adjustedEfficiency),
    rawEfficiency: round2(row.efficiency),
    activeDays: row.activeDays,
  }))

  const snap: FeishuSortEfficiencyDataSnapshot = {
    kind: 'sort_efficiency_v1',
    periodLabel,
    sorting: {
      summary: {
        totalScanCount: scannerResult.summary.totalScanCount,
        totalEffectiveHours: round4(scannerResult.summary.totalEffectiveHours),
        totalEfficiency: round2(scannerResult.summary.totalEfficiency),
        totalDays: scannerResult.summary.totalDays,
        totalScanners: scannerResult.summary.totalScanners,
      },
      daily,
      topScanners,
    },
  }

  if (attendanceResult) {
    const s = attendanceResult.summary
    snap.warehouseAttendance = {
      uploadedVolume: s.uploadedVolume,
      openEfficiency: round2(s.openEfficiency),
      overallEfficiency: round2(s.overallEfficiency),
      openHours: round4(s.openHours),
      allHours: round4(s.allHours),
      openDayCount: s.openDayCount,
      matchedDayCount: s.matchedDayCount,
    }
  }

  return snap
}
