import { getApiBaseUrl } from '../../utils/apiBaseUrl'
import type { AttendanceEfficiencyResult, ScannerEfficiencyResult } from './aggregates'
import { selectTopPerformers, type ScannerTotalEfficiencyRow } from './sortingLookup'

export type EfficiencyInsightAiProvider = 'openai' | 'deepseek'

export type TopPerformer = {
  scanner: string
  reason: string
}

export type EfficiencyAiAnalysis = {
  findings: string[]
  suggestions: string[]
  /** scanner tab 专用；warehouse tab 为空数组 */
  topPerformers: TopPerformer[]
}

export async function generateWarehouseInsight(
  attendanceResult: AttendanceEfficiencyResult,
  aiProvider: EfficiencyInsightAiProvider = 'deepseek',
): Promise<EfficiencyAiAnalysis> {
  const s = attendanceResult.summary
  const response = await fetch(`${getApiBaseUrl()}/api/efficiency-insight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tab: 'warehouse',
      aiProvider,
      openEfficiency: s.openEfficiency,
      overallEfficiency: s.overallEfficiency,
      uploadedVolume: s.uploadedVolume,
      openHours: s.openHours,
      allHours: s.allHours,
      openDayCount: s.openDayCount,
      totalDays: attendanceResult.dailyRows.length,
      dailyRows: attendanceResult.dailyRows.map((r) => ({
        date: r.date,
        volume: r.volume,
        totalHours: r.totalHours,
        isOpenDay: r.isOpenDay,
        dayEfficiency: r.dayEfficiency,
      })),
    }),
  })

  if (!response.ok) {
    const msg = await response.text()
    throw new Error(msg || `HTTP ${response.status}`)
  }

  const data = (await response.json()) as { analysis?: unknown }
  const analysis = (data?.analysis ?? {}) as Record<string, unknown>
  const parsed: EfficiencyAiAnalysis = {
    findings: asStringArray(analysis.findings),
    suggestions: asStringArray(analysis.suggestions),
    topPerformers: [],
  }
  if (!parsed.findings.length && !parsed.suggestions.length) {
    throw new Error('AI 返回内容为空')
  }
  return parsed
}

export async function generateScannerInsight(
  scannerResult: ScannerEfficiencyResult,
  aiProvider: EfficiencyInsightAiProvider = 'deepseek',
  scannerTotalEfficiencyRows?: ScannerTotalEfficiencyRow[],
): Promise<EfficiencyAiAnalysis> {
  const s = scannerResult.summary

  // 前端用确定性算法选出 Top 3，AI 只负责写推荐文案
  const top3 = selectTopPerformers(
    scannerResult.scannerTotalRows,
    scannerTotalEfficiencyRows ?? [],
  )

  const response = await fetch(`${getApiBaseUrl()}/api/efficiency-insight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tab: 'scanner',
      aiProvider,
      totalEfficiency: s.totalEfficiency,
      totalScanCount: s.totalScanCount,
      totalEffectiveHours: s.totalEffectiveHours,
      totalScanners: s.totalScanners,
      totalDays: s.totalDays,
      scannerRows: scannerResult.scannerTotalRows.map((r) => ({
        scanner: r.scanner,
        scanCount: r.scanCount,
        cainiaoShare: r.cainiaoShare ?? 0,
        activeDays: r.activeDays,
        effectiveHours: r.effectiveHours,
        rawEfficiency: r.efficiency,
        cainiaoAdjustedEfficiency: r.cainiaoAdjustedEfficiency ?? r.adjustedEfficiency,
      })),
      // 已由代码确定的 Top 3，AI 只需为每人生成推荐依据
      topPerformerCandidates: top3.map((c) => ({
        scanner: c.scanner,
        scanCount: c.scanCount,
        activeDays: c.activeDays,
        cainiaoShare: c.cainiaoShare ?? 0,
        cainiaoAdjustedEfficiency: c.cainiaoAdjustedEfficiency,
        cainiaoAdjustedTotalEfficiency: c.cainiaoAdjustedTotalEfficiency,
        attendanceTotalHours: c.attendanceTotalHours,
        compositeScore: c.compositeScore,
      })),
    }),
  })

  if (!response.ok) {
    const msg = await response.text()
    throw new Error(msg || `HTTP ${response.status}`)
  }

  const data = (await response.json()) as { analysis?: unknown }
  const analysis = (data?.analysis ?? {}) as Record<string, unknown>

  // AI 只返回 reason 字符串（按 top3 顺序），前端用已确定的扫描员姓名拼合
  const reasons = asStringArray(analysis.topPerformerReasons)
  const topPerformers: TopPerformer[] = top3.map((c, i) => ({
    scanner: c.scanner,
    reason: reasons[i] ?? '',
  }))

  const parsed: EfficiencyAiAnalysis = {
    findings: asStringArray(analysis.findings),
    suggestions: asStringArray(analysis.suggestions),
    topPerformers,
  }
  if (!parsed.findings.length && !parsed.suggestions.length) {
    throw new Error('AI 返回内容为空')
  }
  return parsed
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x ?? '').trim()).filter(Boolean)
}

