import { runOrderAnalyzePipeline, type OrderAnalyzeAiProvider } from '../pipeline'
import type { AnalyzeTarget } from '../types'
import { compareRegressionCase } from './compare'
import { getFixture, listAllFixtureRecords } from './fixtureStore'
import type { RegressionCaseResult, RegressionRunReport } from './types'

export async function runOrderAnalyzeRegression(input: {
  caseIds?: string[]
  aiProvider?: OrderAnalyzeAiProvider
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
  }))

  const { results, tokenUsage } = await runOrderAnalyzePipeline({ targets, aiProvider })
  const resultMap = new Map(results.map((r) => [r.orderNo, r]))

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
