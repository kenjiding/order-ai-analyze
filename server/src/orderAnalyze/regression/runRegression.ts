import { runOrderAnalyzePipeline, runOrderAnalyzePipelineLegacy, type OrderAnalyzeAiProvider } from '../pipeline'
import type { AnalyzeTarget } from '../types'
import { compareRegressionCase } from './compare'
import { getFixture, listAllFixtureRecords } from './fixtureStore'
import type { RegressionCaseResult, RegressionRunReport } from './types'

export async function runOrderAnalyzeRegression(input: {
  caseIds?: string[]
  aiProvider?: OrderAnalyzeAiProvider
  enableDualRunCompare?: boolean
}): Promise<RegressionRunReport> {
  const aiProvider = input.aiProvider ?? 'deepseek'
  const allFixtures = await listAllFixtureRecords()
  const idSet = input.caseIds?.length ? new Set(input.caseIds) : null
  const fixtures = idSet ? allFixtures.filter((f) => idSet.has(f.id)) : allFixtures

  if (!fixtures.length) {
    return {
      summary: { total: 0, passed: 0, failed: 0 },
      cases: [],
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, apiCalls: 0 },
    }
  }

  const targets: AnalyzeTarget[] = fixtures.map((f) => ({
    orderNo: f.orderNo,
    tracks: f.tracks,
    interceptLogs: f.interceptLogs,
    analysisDate: f.capturedAt,
  }))

  const { results, tokenUsage } = await runOrderAnalyzePipeline({ targets, aiProvider })
  const resultMap = new Map(results.map((r) => [r.orderNo, r]))

  const dualRunEnabled = input.enableDualRunCompare === true
  let dualRun:
    | {
        enabled: boolean
        compared: number
        lossScopeMismatches: number
        exceptionCategoryMismatches: number
        mismatchRate: number
        gateMismatchRateThreshold: number
        gatePass: boolean
      }
    | undefined

  if (dualRunEnabled) {
    const { results: legacyResults } = await runOrderAnalyzePipelineLegacy({ targets, aiProvider })
    const legacyMap = new Map(legacyResults.map((row) => [row.orderNo, row]))
    let compared = 0
    let lossScopeMismatches = 0
    let exceptionCategoryMismatches = 0
    for (const result of results) {
      const legacy = legacyMap.get(result.orderNo)
      if (!legacy) continue
      compared += 1
      if (legacy.lossScope !== result.lossScope) lossScopeMismatches += 1
      if (legacy.exceptionCategoryId !== result.exceptionCategoryId) exceptionCategoryMismatches += 1
    }
    const mismatchRate = compared > 0 ? lossScopeMismatches / compared : 0
    const gateMismatchRateThreshold = Number.parseFloat(
      String(process.env.ORDER_ANALYZE_REGRESSION_GATE_MISMATCH_RATE ?? '0.03')
    )
    dualRun = {
      enabled: true,
      compared,
      lossScopeMismatches,
      exceptionCategoryMismatches,
      mismatchRate,
      gateMismatchRateThreshold,
      gatePass: mismatchRate <= gateMismatchRateThreshold,
    }
  }

  const cases: RegressionCaseResult[] = []
  for (const fixture of fixtures) {
    const actual = resultMap.get(fixture.orderNo)
    if (!actual) {
      cases.push({
        id: fixture.id,
        orderNo: fixture.orderNo,
        pass: false,
        mismatches: ['lossScope', 'exceptionCategoryId'],
        expected: fixture.expected,
        actual: {
          lossScope: '需人工判断',
          exceptionCategoryId: '',
          reason: '分析未返回该订单结果',
          confidence: 0,
        },
      })
      continue
    }

    const { pass, mismatches } = compareRegressionCase(fixture.expected, actual)
    cases.push({
      id: fixture.id,
      orderNo: fixture.orderNo,
      pass,
      mismatches,
      expected: fixture.expected,
        actual: {
          lossScope: actual.lossScope,
          exceptionCategoryId: actual.exceptionCategoryId,
          currentResponsibilityParty: actual.currentResponsibilityParty,
          reason: actual.reason,
        confidence: actual.confidence,
        needsReview: actual.needsReview,
        crossCheckedBy: actual.crossCheckedBy,
      },
    })
  }

  const passed = cases.filter((c) => c.pass).length
  return {
    summary: { total: cases.length, passed, failed: cases.length - passed },
    cases,
    tokenUsage,
    dualRun,
  }
}

export async function getRegressionFixtureDetail(id: string) {
  const fixture = await getFixture(id)
  if (!fixture) return null
  return {
    ...fixture,
    trackCount: fixture.tracks.length,
    interceptLogCount: fixture.interceptLogs.length,
  }
}
