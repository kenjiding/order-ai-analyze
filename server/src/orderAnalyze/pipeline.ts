import { normalizeSubType } from './exceptionCatalog'
import {
  analyzeOrdersWithDeepSeek,
  analyzeOrdersWithOpenAi,
  explainOrdersWithDeepSeek,
  explainOrdersWithOpenAi,
  deriveTrackFacts,
  emptyTokenUsage,
  mergeTokenUsage,
  type AnalyzeTarget,
  type OrderAnalyzeResult,
  type TokenUsage,
} from '../openaiOrderAnalyze'
import type { TrackFacts } from './types'
import { classifyOrderFromFacts } from './decisionRules'
import { runWithWarehouseProfileContextAsync, type WarehouseConfigDto } from './warehouseProfiles'

export type OrderAnalyzeAiProvider = 'openai' | 'deepseek'

function readRetryConfidenceThreshold(): number {
  const raw = Number.parseFloat(String(process.env.ORDER_ANALYZE_RETRY_CONFIDENCE_THRESHOLD ?? ''))
  if (!Number.isFinite(raw)) return 0.9
  if (raw < 0) return 0
  if (raw > 1) return 1
  return raw
}

/** ORDER_ANALYZE_CROSS_PROVIDER=off 时回退到同 provider 重试。 */
function readCrossProviderEnabled(): boolean {
  const raw = String(process.env.ORDER_ANALYZE_CROSS_PROVIDER ?? '').trim().toLowerCase()
  return raw !== 'off'
}

function mergeWithCrossCheck(
  primary: OrderAnalyzeResult,
  secondary: OrderAnalyzeResult,
  secondaryProvider: 'openai' | 'deepseek'
): OrderAnalyzeResult {
  if (primary.lossScope === secondary.lossScope) {
    return {
      ...primary,
      confidence: Math.min(0.95, Math.max(primary.confidence, secondary.confidence) + 0.05),
      crossCheckedBy: secondaryProvider,
      needsReview: primary.needsReview === true || secondary.needsReview === true || primary.lossScope === '需人工判断',
      factGuardrailHit: primary.factGuardrailHit,
      reason: primary.factGuardrailHit
        ? primary.reason
        : `${secondary.lossScope === '暂无异常' ? '双模型一致判无异常' : `双模型一致判「${primary.lossScope}」`}；${primary.reason}`,
    }
  }

  const primaryCorrected = Boolean(primary.factGuardrailHit)
  const secondaryCorrected = Boolean(secondary.factGuardrailHit)

  if (primaryCorrected && !secondaryCorrected && primary.needsReview !== true) {
    return { ...primary, crossCheckedBy: secondaryProvider }
  }
  if (!primaryCorrected && secondaryCorrected && secondary.needsReview !== true) {
    return { ...secondary, crossCheckedBy: secondaryProvider }
  }

  return {
    ...primary,
    lossScope: '需人工判断',
    exceptionCategoryId: '',
    confidence: Math.min(primary.confidence, secondary.confidence, 0.8),
    crossCheckedBy: secondaryProvider,
    needsReview: true,
    reason: `[双模型分歧，需人工复核] 主模型: ${primary.lossScope}（${primary.reason}）；副模型: ${secondary.lossScope}（${secondary.reason}）`,
  }
}

export function formatCurrentResponsibilityParty(facts: TrackFacts | undefined): string {
  if (!facts) return '未知'

  if (facts.activeResponsibilityOwner === 'company_warehouse') {
    return facts.activeWarehouseName ?? '未知仓库'
  }
  if (facts.activeResponsibilityOwner === 'external_carrier') {
    return facts.activeExternalCarrierName ?? '未知承运商'
  }
  if (facts.activeResponsibilityOwner === 'merchant') {
    return '商家'
  }
  return '未知'
}

function buildLatestResponsibilityTrackMarker(
  facts: TrackFacts | undefined
): { source: 'track' | 'intercept'; owner: 'in_warehouse' | 'out_warehouse'; time: string } | null {
  if (!facts) return null
  if (!facts.finalResponsibilityOwner || !facts.finalResponsibilityStartTime || !facts.finalResponsibilitySource) {
    return null
  }
  return {
    source: facts.finalResponsibilitySource,
    owner: facts.finalResponsibilityOwner,
    time: facts.finalResponsibilityStartTime,
  }
}

async function analyzeTargetsWithProvider(input: {
  useDeepSeek: boolean
  targets: AnalyzeTarget[]
}): Promise<{ results: OrderAnalyzeResult[]; tokenUsage: TokenUsage }> {
  if (input.useDeepSeek) {
    return analyzeOrdersWithDeepSeek({ targets: input.targets })
  }
  return analyzeOrdersWithOpenAi({ targets: input.targets })
}

async function explainTargetsWithProvider(input: {
  useDeepSeek: boolean
  targets: Array<{
    orderNo: string
    tracks: AnalyzeTarget['tracks']
    interceptLogs?: AnalyzeTarget['interceptLogs']
    deterministicLossScope: OrderAnalyzeResult['lossScope']
    deterministicSubType: string
    deterministicReason: string
    analysisDate?: AnalyzeTarget['analysisDate']
  }>
}): Promise<{ results: Array<{ orderNo: string; reason: string }>; tokenUsage: TokenUsage }> {
  if (input.useDeepSeek) {
    return explainOrdersWithDeepSeek({ targets: input.targets })
  }
  return explainOrdersWithOpenAi({ targets: input.targets })
}

function mergeAiExplanation(input: {
  deterministic: OrderAnalyzeResult
  ai?: { orderNo: string; reason: string }
  provider: OrderAnalyzeAiProvider
}): OrderAnalyzeResult {
  const { deterministic, ai, provider } = input
  if (!ai) return deterministic
  const reason = (ai.reason ?? '').trim()
  if (!reason) return deterministic
  return {
    ...deterministic,
    reason,
    confidence: deterministic.confidence,
    needsReview: deterministic.needsReview,
    crossCheckedBy: provider,
  }
}

function finalizeResultWithFacts(result: OrderAnalyzeResult, facts: TrackFacts | undefined): OrderAnalyzeResult {
  return {
    ...result,
    exceptionCategoryId: normalizeSubType({
      lossScope: result.lossScope,
      subType: result.exceptionCategoryId,
      facts,
    }),
    currentResponsibilityParty: formatCurrentResponsibilityParty(facts),
    activeResponsibilityOwner: facts?.activeResponsibilityOwner,
    latestResponsibilityTrackMarker: buildLatestResponsibilityTrackMarker(facts),
  }
}

export async function runOrderAnalyzePipelineLegacy(input: {
  targets: AnalyzeTarget[]
  aiProvider: OrderAnalyzeAiProvider
  warehouseConfig?: WarehouseConfigDto | null
}): Promise<{ results: OrderAnalyzeResult[]; tokenUsage: TokenUsage }> {
  return runWithWarehouseProfileContextAsync(input.warehouseConfig, async () => {
  const { targets } = input
  const useDeepSeek = input.aiProvider === 'deepseek'

  let tokenUsage = emptyTokenUsage()

  const { results: primaryResults, tokenUsage: primaryUsage } = await analyzeTargetsWithProvider({
    useDeepSeek,
    targets,
  })
  tokenUsage = mergeTokenUsage(tokenUsage, primaryUsage)

  const targetFactsMap = new Map(
    targets.map((t) => [t.orderNo, deriveTrackFacts(t.tracks, t.interceptLogs ?? [], { analysisDate: t.analysisDate })])
  )
  const guardedResults = primaryResults.map((r) => {
    const facts = targetFactsMap.get(r.orderNo)
    if (!facts) return r
    const deterministic = classifyOrderFromFacts({ orderNo: r.orderNo, facts })
    return {
      ...r,
      lossScope: deterministic.lossScope,
      exceptionCategoryId: deterministic.exceptionCategoryId,
      reason: deterministic.reason,
      confidence: deterministic.confidence,
      needsReview: deterministic.needsReview,
      factGuardrailHit: deterministic.factGuardrailHit,
      appliedDecisionRuleId: deterministic.appliedDecisionRuleId,
    }
  })

  const crossProviderEnabled = readCrossProviderEnabled()
  let finalResults = guardedResults

  if (crossProviderEnabled) {
    const retryThreshold = readRetryConfidenceThreshold()
    const crossCheckTargets = guardedResults
      .filter((r) => r.needsReview === true || r.confidence < retryThreshold)
      .map((r) => targets.find((t) => t.orderNo === r.orderNo))
      .filter(Boolean) as AnalyzeTarget[]

    if (crossCheckTargets.length) {
      const { results: secondaryResults, tokenUsage: secondaryUsage } = await analyzeTargetsWithProvider({
        useDeepSeek: !useDeepSeek,
        targets: crossCheckTargets,
      })
      tokenUsage = mergeTokenUsage(tokenUsage, secondaryUsage)
      const guardedSecondaryResults = secondaryResults.map((r) => {
        const facts = targetFactsMap.get(r.orderNo)
        if (!facts) return r
        const deterministic = classifyOrderFromFacts({ orderNo: r.orderNo, facts })
        return {
          ...r,
          lossScope: deterministic.lossScope,
          exceptionCategoryId: deterministic.exceptionCategoryId,
          reason: deterministic.reason,
          confidence: deterministic.confidence,
          needsReview: deterministic.needsReview,
          factGuardrailHit: deterministic.factGuardrailHit,
          appliedDecisionRuleId: deterministic.appliedDecisionRuleId,
        }
      })
      const secondaryMap = new Map(guardedSecondaryResults.map((r) => [r.orderNo, r]))
      const secondaryProvider: 'openai' | 'deepseek' = useDeepSeek ? 'openai' : 'deepseek'

      finalResults = guardedResults.map((primary) => {
        const secondary = secondaryMap.get(primary.orderNo)
        if (!secondary) return primary
        return mergeWithCrossCheck(primary, secondary, secondaryProvider)
      })
    }
  } else {
    const retryThreshold = readRetryConfidenceThreshold()
    const lowConfidenceTargets = guardedResults
      .filter((r) => r.confidence < retryThreshold)
      .map((r) => targets.find((t) => t.orderNo === r.orderNo))
      .filter(Boolean) as AnalyzeTarget[]

    if (lowConfidenceTargets.length) {
      const { results: retriedResults, tokenUsage: retryUsage } = await analyzeTargetsWithProvider({
        useDeepSeek,
        targets: lowConfidenceTargets,
      })
      tokenUsage = mergeTokenUsage(tokenUsage, retryUsage)
      const guardedRetriedResults = retriedResults.map((r) => {
        const facts = targetFactsMap.get(r.orderNo)
        if (!facts) return r
        const deterministic = classifyOrderFromFacts({ orderNo: r.orderNo, facts })
        return {
          ...r,
          lossScope: deterministic.lossScope,
          exceptionCategoryId: deterministic.exceptionCategoryId,
          reason: deterministic.reason,
          confidence: deterministic.confidence,
          needsReview: deterministic.needsReview,
          factGuardrailHit: deterministic.factGuardrailHit,
          appliedDecisionRuleId: deterministic.appliedDecisionRuleId,
        }
      })
      const retryMap = new Map(guardedRetriedResults.map((r) => [r.orderNo, r]))
      finalResults = guardedResults.map((original) => {
        const retried = retryMap.get(original.orderNo)
        if (!retried) return original
        return retried.confidence >= original.confidence ? retried : original
      })
    }
  }

  const normalizedResults = finalResults.map((r) => ({
    ...finalizeResultWithFacts(r, targetFactsMap.get(r.orderNo)),
  }))

  return { results: normalizedResults, tokenUsage }
  })
}

export async function runOrderAnalyzePipeline(input: {
  targets: AnalyzeTarget[]
  aiProvider: OrderAnalyzeAiProvider
  enableAiExplain?: boolean
  warehouseConfig?: WarehouseConfigDto | null
}): Promise<{ results: OrderAnalyzeResult[]; tokenUsage: TokenUsage; trackFacts: Record<string, TrackFacts> }> {
  return runWithWarehouseProfileContextAsync(input.warehouseConfig, async () => {
  const { targets } = input
  const useDeepSeek = input.aiProvider === 'deepseek'
  const targetFactsMap = new Map(
    targets.map((t) => [t.orderNo, deriveTrackFacts(t.tracks, t.interceptLogs ?? [], { analysisDate: t.analysisDate })])
  )

  const deterministicResults = targets.map((target) => {
    const facts = targetFactsMap.get(target.orderNo)
    if (!facts) {
      return {
        orderNo: target.orderNo,
        lossScope: '需人工判断' as const,
        exceptionCategoryId: '',
        reason: '缺少可用轨迹事实，需人工复核',
        confidence: 0,
        needsReview: true,
      }
    }
    return classifyOrderFromFacts({ orderNo: target.orderNo, facts })
  })

  let tokenUsage = emptyTokenUsage()
  let mergedResults = deterministicResults

  if (input.enableAiExplain) {
    const explainTargets = deterministicResults
      .filter((result) => result.needsReview === true)
      .map((result) => {
        const target = targets.find((row) => row.orderNo === result.orderNo)
        if (!target) return null
        return {
          orderNo: result.orderNo,
          tracks: target.tracks,
          interceptLogs: target.interceptLogs ?? [],
          analysisDate: target.analysisDate,
          deterministicLossScope: result.lossScope,
          deterministicSubType: result.exceptionCategoryId,
          deterministicReason: result.reason,
        }
      })
      .filter(Boolean) as Array<{
      orderNo: string
      tracks: AnalyzeTarget['tracks']
      interceptLogs?: AnalyzeTarget['interceptLogs']
      deterministicLossScope: OrderAnalyzeResult['lossScope']
      deterministicSubType: string
      deterministicReason: string
      analysisDate?: AnalyzeTarget['analysisDate']
    }>

    if (explainTargets.length > 0) {
      try {
        const { results: aiResults, tokenUsage: explainUsage } = await explainTargetsWithProvider({
          useDeepSeek,
          targets: explainTargets,
        })
        tokenUsage = mergeTokenUsage(tokenUsage, explainUsage)
        const aiMap = new Map(aiResults.map((result) => [result.orderNo, result]))
        mergedResults = deterministicResults.map((deterministic) =>
          mergeAiExplanation({
            deterministic,
            ai: aiMap.get(deterministic.orderNo),
            provider: input.aiProvider,
          })
        )
      } catch {
        mergedResults = deterministicResults
      }
    }
  }

  const normalizedResults = mergedResults.map((result) =>
    finalizeResultWithFacts(result, targetFactsMap.get(result.orderNo))
  )
  const trackFacts: Record<string, TrackFacts> = Object.fromEntries(targetFactsMap.entries())
  return { results: normalizedResults, tokenUsage, trackFacts }
  })
}
