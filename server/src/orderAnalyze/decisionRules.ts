import type { AiLossScope, OrderAnalyzeResult, TrackFacts } from './types'
import { EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS } from './warehouseProfiles'

/**
 * 商家处理方向（暂存 / Abandon销毁 / 退返商家）是同一类状态：包裹已脱离正常履约，
 * 由商家指令接管，不适用库内/库外超时。方向有效直到包裹回到履约流程为止
 * （预约派送 / 真出库 / 分配给派件员，见 merchantDirectionUnfrozen）。
 *
 * 曾用「指令后有无物理扫描 + 当前是否已超时」做反证，有两个致命问题，已移除：
 * 1. 反证用的是「责任点距今」而非「距指令下达时」，同一条轨迹的结论会随分析日期翻转
 *    （真实案例 6080126833322：09-14 判暂无异常，09-15 起判库内丢失）；
 * 2. Abandon 语义上就是就地销毁，之后不可能再有扫描，「指令后需有物理扫描」恒不成立。
 */
function isDirectionTerminalEffective(directionActive: boolean, facts: TrackFacts): boolean {
  if (!directionActive) return false
  return !facts.merchantDirectionUnfrozen
}

type DecisionRule = {
  id: string
  priority: number
  description: string
  appliesTo?: readonly AiLossScope[]
  match: (input: { result: OrderAnalyzeResult; facts: TrackFacts }) => boolean
  resolve: (input: { result: OrderAnalyzeResult; facts: TrackFacts }) => OrderAnalyzeResult
}

const TERMINAL_RULE_IDS = new Set([
  'latest_order_exception_closed_terminal',
  'merchant_destroy_terminal',
  'merchant_abandon_terminal',
  'merchant_storage_terminal',
  'merchant_return_terminal',
  'delivery_completion_terminal',
])

function appliesToResult(rule: DecisionRule, result: OrderAnalyzeResult): boolean {
  return !rule.appliesTo || rule.appliesTo.includes(result.lossScope)
}

function withRuleHit(input: {
  result: OrderAnalyzeResult
  ruleId: string
  lossScope: AiLossScope
  exceptionCategoryId?: string
  confidence: number
  needsReview: boolean
  hit: string
  reason: string
}): OrderAnalyzeResult {
  return {
    ...input.result,
    lossScope: input.lossScope,
    exceptionCategoryId: input.exceptionCategoryId ?? '',
    confidence: input.confidence,
    needsReview: input.needsReview,
    factGuardrailHit: input.hit,
    appliedDecisionRuleId: input.ruleId,
    reason: input.reason,
  }
}

/**
 * 库内/库外丢失的唯一时效口径：最终责任点距今天数必须达到当前仓库配置的「仓库丢失超时（天）」。
 * 分配-取消循环只是责任归属线索（决定子类型，见 inWarehouseLossSubType），绝不构成独立的丢失判定条件——
 * 曾存在「循环 + 距今≥5天」捷径，导致 5 天即被判库内丢失（真实案例：3781059314407），已移除。
 */
function expectedScopeFromFinalResponsibility(facts: TrackFacts): AiLossScope | null {
  if (!facts.finalResponsibilityOwner || facts.finalResponsibilityDaysDiff < 0) return null

  if (
    facts.finalResponsibilityOwner === 'in_warehouse' &&
    facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays
  ) {
    return '库内丢失'
  }

  if (
    facts.finalResponsibilityOwner === 'out_warehouse' &&
    facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays
  ) {
    return '库外丢失'
  }

  return '暂无异常'
}

/**
 * 库内丢失子类型：已达到仓库超时阈值的前提下，若「最后一次库内实物确认（回仓/盘点/入库扫描）之后」
 * 出现过「分配→取消」配对（1 组即算）且此后未再成功出库，说明包裹被实物确认在仓后由某个派件员
 * 领走又取消、从此再无任何真实操作，用更具体的「疑似派件员窃取」；其余情形维持「扫描员丢失」。
 * 本函数只影响子类型，不参与是否构成丢失的判定。
 *
 * 这里用 assignCancelPairWithoutDispatch 而非 assignCancelLoopWithoutDispatch（全轨迹历史最大连续
 * ≥2 组）：后者仍是虚假转运等规则的口径，两者刻意分开，改子类型口径不得波及那些判定。
 */
function inWarehouseLossSubType(facts: TrackFacts): string {
  // 暂存冻结被退返方向释放后，唯一在跑的是退返时效；此路径下超时必为退返超时，
  // 而非扫描员滞留——冻结期间仓库没有累积责任，超的是商家给的退返窗口。
  if (facts.merchantStorageReleasedByReturn && facts.merchantReturnDirectionActive && !facts.merchantReturnClosed) {
    return '退返超时'
  }
  return facts.assignCancelPairWithoutDispatch ? '疑似派件员窃取' : '扫描员丢失'
}

function formatActiveOwner(owner: TrackFacts['activeResponsibilityOwner']): string {
  if (owner === 'company_warehouse') return '公司仓库'
  if (owner === 'external_carrier') return '外部承运商'
  if (owner === 'merchant') return '商家'
  return '未知'
}

function formatSegmentStatus(status: TrackFacts['activeSegmentStatus']): string {
  if (status === 'in_warehouse') return '在库'
  if (status === 'out_warehouse') return '库外派送中'
  if (status === 'external_carrier') return '外部承运中'
  if (status === 'merchant_terminal') return '商家终态'
  return '未知'
}

type EvidenceScope = 'in_warehouse' | 'out_warehouse' | 'active'

function resolveEvidenceScope(
  facts: TrackFacts,
  scope?: EvidenceScope
): EvidenceScope {
  if (scope) return scope
  if (facts.finalResponsibilityOwner === 'in_warehouse') return 'in_warehouse'
  if (facts.finalResponsibilityOwner === 'out_warehouse') return 'out_warehouse'
  return 'active'
}

function buildContextLine(facts: TrackFacts, scope: EvidenceScope = 'active'): string {
  const status =
    scope === 'in_warehouse'
      ? '在库'
      : scope === 'out_warehouse'
        ? '库外派送中'
        : formatSegmentStatus(facts.activeSegmentStatus)
  return `当前责任主体是${formatActiveOwner(facts.activeResponsibilityOwner)}，责任仓为「${facts.activeWarehouseName ?? '未知'}」，当前状态为「${status}」`
}

function buildTimingEvidence(facts: TrackFacts, scope: EvidenceScope): string {
  if (scope === 'in_warehouse') {
    const parts: string[] = []
    if (facts.inWarehouseStartTime && facts.inWarehouseDaysDiff >= 0) {
      parts.push(`库内起算：${facts.inWarehouseStartTime}（距今 ${facts.inWarehouseDaysDiff} 天）`)
    }
    if (facts.lastDispatchedOutTime) {
      parts.push(`最近出库：${facts.lastDispatchedOutTime}（库外起算距今 ${facts.outWarehouseDaysDiff} 天）`)
    }
    if (!parts.length) return ''
    return ` 库内责任，${parts.join('；')}；`
  }

  if (scope === 'out_warehouse') {
    const parts: string[] = []
    if (facts.finalResponsibilityStartTime && facts.finalResponsibilityDaysDiff >= 0) {
      parts.push(`库外起算：${facts.finalResponsibilityStartTime}（距今 ${facts.finalResponsibilityDaysDiff} 天）`)
    } else if (facts.lastDispatchedOutTime && facts.outWarehouseDaysDiff >= 0) {
      parts.push(`库外起算：${facts.lastDispatchedOutTime}（距今 ${facts.outWarehouseDaysDiff} 天）`)
    }
    if (!parts.length) return ''
    return ` 库外责任，${parts.join('；')}；`
  }

  return ''
}

function noExceptionSubTypeFromFacts(facts: TrackFacts): string {
  if (facts.latestOrderExceptionClosed) return '订单已完结'
  // 签收晚于最新商家方向时以签收为准；商家方向更新时才沿用商家子类型
  if (facts.deliveryCompletionSupersedesMerchantDirection) return '已签收'
  if (facts.merchantDestroyConfirmed || facts.merchantAbandonActive) return 'Abandon销毁'
  if (facts.merchantStorageActive) return '暂存'
  if (facts.merchantReturnClosed || facts.merchantReturnDirectionActive) return '退返商家'
  if (facts.hasDeliveryCompletion) return '已签收'
  return ''
}

function appendEvidence(
  reason: string,
  facts: TrackFacts,
  mode: 'full' | 'context' | 'none' = 'full',
  scope?: EvidenceScope
): string {
  if (mode === 'none') return reason
  const resolvedScope = resolveEvidenceScope(facts, scope)
  const context = buildContextLine(facts, mode === 'context' ? 'active' : resolvedScope)
  if (mode === 'context') return `${reason}。依据：${context}。`
  return `${reason}。依据：${context}。${buildTimingEvidence(facts, resolvedScope)}`
}

function buildDeterministicBaseResult(input: {
  orderNo: string
  facts: TrackFacts
}): OrderAnalyzeResult {
  const { orderNo, facts } = input

  if (facts.latestOrderExceptionClosed) {
    return {
      orderNo,
      lossScope: '暂无异常',
      exceptionCategoryId: '订单已完结',
      confidence: 0.95,
      needsReview: false,
      reason: appendEvidence(
        `最新轨迹为订单异常完结（${facts.latestOrderExceptionClosedTime ?? '-'}，${facts.latestOrderExceptionClosedEvidence ?? '命中订单异常完结'}），订单已闭环`,
        facts,
        'none'
      ),
    }
  }
  if (facts.deliveryCompletionSupersedesMerchantDirection) {
    return {
      orderNo,
      lossScope: '暂无异常',
      exceptionCategoryId: '已签收',
      confidence: 0.95,
      needsReview: false,
      reason: appendEvidence(
        `轨迹已正常完结（${facts.deliveryCompletionTime ?? '-'}，${facts.deliveryCompletionEvidence ?? '命中签收/妥投/派件完成关键词'}），且晚于最新商家处理方向，订单已履约闭环`,
        facts,
        'none'
      ),
    }
  }
  if (isDirectionTerminalEffective(facts.merchantDestroyConfirmed, facts) || isDirectionTerminalEffective(facts.merchantAbandonActive, facts)) {
    return {
      orderNo,
      lossScope: '暂无异常',
      exceptionCategoryId: 'Abandon销毁',
      confidence: 0.92,
      needsReview: false,
      reason: appendEvidence(
        `轨迹命中商家销毁/Abandon终态（${facts.merchantDestroyConfirmTime ?? facts.merchantAbandonConfirmTime ?? '-'}，${facts.merchantDestroyEvidence ?? facts.merchantAbandonEvidence ?? '命中销毁信号'}）`,
        facts,
        'none'
      ),
    }
  }
  if (isDirectionTerminalEffective(facts.merchantStorageActive, facts)) {
    return {
      orderNo,
      lossScope: '暂无异常',
      exceptionCategoryId: '暂存',
      confidence: 0.9,
      needsReview: false,
      reason: appendEvidence(
        `轨迹命中商家暂存终态（${facts.merchantStorageConfirmTime ?? '-'}，${facts.merchantStorageEvidence ?? '命中暂存信号'}）`,
        facts,
        'none'
      ),
    }
  }
  if (facts.merchantReturnClosed) {
    return {
      orderNo,
      lossScope: '暂无异常',
      exceptionCategoryId: '退返商家',
      confidence: 0.9,
      needsReview: false,
      reason: appendEvidence(
        `轨迹命中退返商家闭环（${facts.merchantReturnClosedTime ?? '-'}，${facts.merchantReturnClosedEvidence ?? '命中退返闭环信号'}）`,
        facts,
        'none'
      ),
    }
  }
  if (facts.hasDeliveryCompletion) {
    return {
      orderNo,
      lossScope: '暂无异常',
      exceptionCategoryId: '已签收',
      confidence: 0.9,
      needsReview: false,
      reason: appendEvidence(
        `轨迹已正常完结（${facts.deliveryCompletionTime ?? '-'}，${facts.deliveryCompletionEvidence ?? '命中签收/妥投/派件完成关键词'}）`,
        facts,
        'none'
      ),
    }
  }

  if (facts.activeResponsibilityOwner === 'external_carrier') {
    const stale = facts.lastEventDaysDiff >= facts.externalCarrierLossTimeoutDays
    return {
      orderNo,
      lossScope: stale ? '3PL丢件' : '暂无异常',
      exceptionCategoryId: '',
      confidence: stale ? 0.9 : 0.82,
      needsReview: false,
      reason: appendEvidence(
        stale
          ? `当前责任主体为外部承运商（${facts.activeExternalCarrierName ?? '-'}），最后更新距今 ${facts.lastEventDaysDiff} 天，已达到外部承运阈值 ${facts.externalCarrierLossTimeoutDays} 天`
          : `当前责任主体为外部承运商（${facts.activeExternalCarrierName ?? '-'}），最后更新距今 ${facts.lastEventDaysDiff} 天，未达到外部承运阈值 ${facts.externalCarrierLossTimeoutDays} 天`,
        facts,
        'none'
      ),
    }
  }

  if (facts.unknownWarehouseInActiveSegment) {
    return {
      orderNo,
      lossScope: '需人工判断',
      exceptionCategoryId: '',
      confidence: 0.5,
      needsReview: true,
      reason: appendEvidence(
        `当前仓库 ${facts.activeWarehouseName ?? '-'} 未匹配配置，无法可靠区分真实操作员、非真实账号和系统账号，需人工判断`,
        facts,
        'context'
      ),
    }
  }

  if (!facts.hasRealOperatorScan && facts.lastDispatchedOutTime === null) {
    if (facts.assignCancelLoopWithoutDispatch) {
      return {
        orderNo,
        lossScope: '虚假转运',
        exceptionCategoryId: '',
        confidence: 0.88,
        needsReview: false,
        reason: appendEvidence('无真实扫描且存在无成功出库的分配-取消循环，判定虚假转运', facts, 'context'),
      }
    }
    return {
      orderNo,
      lossScope: '需人工判断',
      exceptionCategoryId: '',
      confidence: 0.55,
      needsReview: true,
      reason: appendEvidence('缺少真实扫描与有效责任锚点，需人工复核', facts, 'context'),
    }
  }

  const expectedScope = expectedScopeFromFinalResponsibility(facts)
  if (expectedScope === '库内丢失') {
    return {
      orderNo,
      lossScope: '库内丢失',
      exceptionCategoryId: inWarehouseLossSubType(facts),
      confidence: 0.88,
      needsReview: false,
      reason: appendEvidence(
        `最终责任点为库内，距今 ${facts.finalResponsibilityDaysDiff} 天，达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值`,
        facts,
        'full',
        'in_warehouse'
      ),
    }
  }
  if (expectedScope === '库外丢失') {
    return {
      orderNo,
      lossScope: '库外丢失',
      exceptionCategoryId: '快递员丢失',
      confidence: 0.9,
      needsReview: false,
      reason: appendEvidence(
        `最终责任点为库外，距今 ${facts.finalResponsibilityDaysDiff} 天，达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值`,
        facts,
        'full',
        'out_warehouse'
      ),
    }
  }
  if (expectedScope === '暂无异常') {
    return {
      orderNo,
      lossScope: '暂无异常',
      exceptionCategoryId: noExceptionSubTypeFromFacts(facts),
      confidence: 0.7,
      needsReview: false,
      reason: appendEvidence('当前责任段未命中丢失阈值或终态异常条件，判定暂无异常', facts, 'full'),
    }
  }

  return {
    orderNo,
    lossScope: '需人工判断',
    exceptionCategoryId: '',
    confidence: 0.5,
    needsReview: true,
    reason: appendEvidence('无法由确定性规则稳定判定，需人工复核', facts, 'context'),
  }
}

export const DECISION_RULES: readonly DecisionRule[] = [
  {
    id: 'latest_order_exception_closed_terminal',
    priority: 9,
    description: '最新轨迹为订单异常完结时，订单已闭环，不再归责为库内/库外/3PL/虚假转运。',
    match: ({ result, facts }) =>
      facts.latestOrderExceptionClosed &&
      (result.lossScope !== '暂无异常' || result.exceptionCategoryId !== '订单已完结'),
    resolve: ({ result, facts }) => {
      const hit = `最新轨迹命中订单异常完结终态（${facts.latestOrderExceptionClosedTime ?? '-'}，${facts.latestOrderExceptionClosedEvidence ?? '命中订单异常完结'}），订单已闭环，不再适用库内/库外/干线异常归责`
      return withRuleHit({
        result,
        ruleId: 'latest_order_exception_closed_terminal',
        lossScope: '暂无异常',
        exceptionCategoryId: '订单已完结',
        confidence: Math.max(0.9, result.confidence),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'merchant_destroy_terminal',
    priority: 10,
    description: '商家已确认销毁，且指令有效（有物理支撑或尚未超时）时，终态闭环优先于所有丢失归责。',
    match: ({ result, facts }) =>
      isDirectionTerminalEffective(facts.merchantDestroyConfirmed, facts) &&
      !facts.deliveryCompletionSupersedesMerchantDirection &&
      (result.lossScope !== '暂无异常' || result.exceptionCategoryId !== 'Abandon销毁'),
    resolve: ({ result, facts }) => {
      const hit = `轨迹命中商家销毁终态（${facts.merchantDestroyConfirmTime ?? '-'}，${facts.merchantDestroyEvidence ?? '命中销毁关键词'}），该单已进入商家确认销毁闭环，不应归责为库内/库外/干线异常`
      return withRuleHit({
        result,
        ruleId: 'merchant_destroy_terminal',
        lossScope: '暂无异常',
        exceptionCategoryId: 'Abandon销毁',
        confidence: Math.max(0.9, result.confidence),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'merchant_abandon_terminal',
    priority: 10.5,
    description: '商家已给出 Abandon 处理指令，且指令有效（有物理支撑或尚未超时）时，判定为暂无异常并设置 Abandon销毁 子类型。',
    match: ({ result, facts }) =>
      isDirectionTerminalEffective(facts.merchantAbandonActive, facts) &&
      !facts.deliveryCompletionSupersedesMerchantDirection &&
      (result.lossScope !== '暂无异常' || result.exceptionCategoryId !== 'Abandon销毁'),
    resolve: ({ result, facts }) => {
      const closedNote = facts.merchantAbandonClosed
        ? `；已闭环「退件已销毁」（${facts.merchantAbandonClosedTime ?? '-'}，${facts.merchantAbandonClosedEvidence ?? '命中退件已销毁'}）`
        : ''
      const hit = `轨迹命中商家Abandon销毁终态（${facts.merchantAbandonConfirmTime ?? '-'}，${facts.merchantAbandonEvidence ?? '命中Abandon关键词'}${closedNote}），该单已进入Abandon销毁处理方向且为当前最新商家反馈，不应归责为库内/库外/干线异常`
      return withRuleHit({
        result,
        ruleId: 'merchant_abandon_terminal',
        lossScope: '暂无异常',
        exceptionCategoryId: 'Abandon销毁',
        confidence: Math.max(0.9, result.confidence),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'merchant_storage_terminal',
    priority: 11,
    description: '商家暂存且后续未预约派送，且指令有效（有物理支撑或尚未超时）时，暂存不适用库内/库外超时逻辑。',
    match: ({ result, facts }) =>
      isDirectionTerminalEffective(facts.merchantStorageActive, facts) &&
      !facts.deliveryCompletionSupersedesMerchantDirection &&
      (result.lossScope !== '暂无异常' || result.exceptionCategoryId !== '暂存'),
    resolve: ({ result, facts }) => {
      const hit = `轨迹命中商家暂存终态（${facts.merchantStorageConfirmTime ?? '-'}，${facts.merchantStorageEvidence ?? '命中暂存关键词'}），且后续未出现预约派送；暂存不适用库内/库外超时逻辑，后续盘点/退件轨迹不改变结论`
      return withRuleHit({
        result,
        ruleId: 'merchant_storage_terminal',
        lossScope: '暂无异常',
        exceptionCategoryId: '暂存',
        confidence: Math.max(0.9, result.confidence),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'merchant_return_terminal',
    priority: 12,
    description: '退返/退回商家已闭环时，不归入库内/库外丢失。若存在更新的 Abandon 指令，则 Abandon 优先。',
    match: ({ result, facts }) =>
      facts.merchantReturnClosed &&
      !facts.merchantAbandonActive &&
      !facts.deliveryCompletionSupersedesMerchantDirection &&
      (result.lossScope !== '暂无异常' || result.exceptionCategoryId !== '退返商家'),
    resolve: ({ result, facts }) => {
      const hit = `轨迹命中退返商家闭环（${facts.merchantReturnClosedTime ?? '-'}，${facts.merchantReturnClosedEvidence ?? '命中退返闭环关键词'}），该单已完成退返/退回商家，不应归责为库内/库外异常`
      return withRuleHit({
        result,
        ruleId: 'merchant_return_terminal',
        lossScope: '暂无异常',
        exceptionCategoryId: '退返商家',
        confidence: Math.max(0.88, result.confidence),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'merchant_storage_superseded_by_progress',
    priority: 48,
    description: '暂存后出现退件意见或装箱转运等明确业务推进时，只清理暂存子类型，不覆盖当前责任事实。',
    match: ({ result, facts }) =>
      facts.merchantStorageSupersededByBusinessProgress &&
      result.lossScope === '暂无异常' &&
      result.exceptionCategoryId === '暂存',
    resolve: ({ result, facts }) => {
      const hit = `暂存后已出现新的业务推进（${facts.merchantStorageBusinessProgressTime ?? '-'}，${facts.merchantStorageBusinessProgressEvidence ?? '命中后续业务轨迹'}），应以最新轨迹为准，不再使用暂存子类型`
      return withRuleHit({
        result,
        ruleId: 'merchant_storage_superseded_by_progress',
        lossScope: '暂无异常',
        confidence: Math.max(0.75, Math.min(result.confidence, 0.9)),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'delivery_completion_terminal',
    priority: 9.5,
    description:
      '轨迹已出现签收/妥投/派件完成等正常完结时，不得再归责为库内/库外/虚假转运；子类型对齐当前最新事实（签收晚于商家方向判「已签收」，商家方向更新则沿用商家子类型）。',
    // 期望子类型不是「已签收」时（商家方向更新、或订单异常完结），让位给对应终态规则，保证 reason 文案与结论一致
    match: ({ result, facts }) =>
      facts.hasDeliveryCompletion &&
      noExceptionSubTypeFromFacts(facts) === '已签收' &&
      (result.lossScope !== '暂无异常' || result.exceptionCategoryId !== '已签收'),
    resolve: ({ result, facts }) => {
      const hit = `轨迹命中正常完结（${facts.deliveryCompletionTime ?? '-'}，${facts.deliveryCompletionEvidence ?? '命中签收/妥投/派件完成关键词'}），订单已完成履约，不再适用库内/库外超时归责`
      return withRuleHit({
        result,
        ruleId: 'delivery_completion_terminal',
        lossScope: '暂无异常',
        exceptionCategoryId: '已签收',
        confidence: Math.max(0.88, result.confidence),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'external_carrier_stale_is_3pl_loss',
    priority: 21,
    description: `当前已转交外部承运且最后更新达到 ${EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS} 天时，归入 3PL 丢件。`,
    match: ({ result, facts }) =>
      facts.activeResponsibilityOwner === 'external_carrier' &&
      facts.lastEventDaysDiff >= facts.externalCarrierLossTimeoutDays &&
      (result.lossScope !== '3PL丢件' ||
        result.exceptionCategoryId !== '' ||
        result.needsReview === true ||
        !result.factGuardrailHit),
    resolve: ({ result, facts }) => {
      const hit = `当前责任主体为外部承运商 ${facts.activeExternalCarrierName ?? '-'}，转交时间 ${facts.externalCarrierTransferTime ?? '-'}，最后更新距今 ${facts.lastEventDaysDiff} 天；公司仓库责任已完成转交，外部承运超 ${facts.externalCarrierLossTimeoutDays} 天未正常完结`
      return withRuleHit({
        result,
        ruleId: 'external_carrier_stale_is_3pl_loss',
        lossScope: '3PL丢件',
        exceptionCategoryId: '',
        confidence: Math.max(0.9, result.confidence),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}，判定为 3PL丢件。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'external_carrier_handoff_not_overdue',
    priority: 22,
    description: `当前已转交外部承运且最后更新未达到 ${EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS} 天复核阈值时，不应判库内/库外丢失。`,
    match: ({ result, facts }) =>
      facts.activeResponsibilityOwner === 'external_carrier' &&
      facts.lastEventDaysDiff >= 0 &&
      facts.lastEventDaysDiff < facts.externalCarrierLossTimeoutDays &&
      result.lossScope !== '暂无异常',
    resolve: ({ result, facts }) => {
      const hit = `当前责任主体为外部承运商 ${facts.activeExternalCarrierName ?? '-'}，转交时间 ${facts.externalCarrierTransferTime ?? '-'}，最后更新距今 ${facts.lastEventDaysDiff} 天，未达到 ${facts.externalCarrierLossTimeoutDays} 天复核阈值；公司仓库责任已完成转交`
      return withRuleHit({
        result,
        ruleId: 'external_carrier_handoff_not_overdue',
        lossScope: '暂无异常',
        confidence: Math.max(0.8, Math.min(result.confidence, 0.92)),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'non_external_carrier_cannot_be_3pl_loss',
    priority: 24.5,
    description: '只有当前责任主体为外部承运商时才能判定 3PL 丢件。',
    appliesTo: ['3PL丢件'],
    match: ({ facts }) => facts.activeResponsibilityOwner !== 'external_carrier',
    resolve: ({ result, facts }) => {
      const hit = `当前责任主体为 ${facts.activeResponsibilityOwner}，未处于外部承运商责任段，不能判定为 3PL丢件`
      return withRuleHit({
        result,
        ruleId: 'non_external_carrier_cannot_be_3pl_loss',
        lossScope: '需人工判断',
        exceptionCategoryId: '',
        confidence: Math.min(result.confidence, 0.55),
        needsReview: true,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'unknown_active_warehouse_needs_review',
    priority: 25,
    description: '当前仓库未匹配配置时，禁止用全局默认扫描员规则作高置信库内/库外判断。',
    appliesTo: ['库内丢失', '库外丢失', '虚假转运'],
    match: ({ facts }) => facts.unknownWarehouseInActiveSegment,
    resolve: ({ result, facts }) => {
      const hit = `当前仓库 ${facts.activeWarehouseName ?? '-'} 未匹配仓库配置，无法可靠区分真实操作员、非真实账号和系统账号`
      return withRuleHit({
        result,
        ruleId: 'unknown_active_warehouse_needs_review',
        lossScope: '需人工判断',
        confidence: Math.min(result.confidence, 0.55),
        needsReview: true,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'company_warehouse_missing_basis_needs_review',
    priority: 26,
    description: '当前仍在公司仓责任段但缺少真实扫描、回仓、盘点或出库起算证据时，证据不足必须进入人工判断。',
    match: ({ result, facts }) =>
      facts.activeResponsibilityOwner === 'company_warehouse' &&
      facts.activeSegmentStatus === 'in_warehouse' &&
      facts.activeWarehouseKnown &&
      !isDirectionTerminalEffective(facts.merchantDestroyConfirmed, facts) &&
      !isDirectionTerminalEffective(facts.merchantAbandonActive, facts) &&
      !facts.merchantReturnClosed &&
      !isDirectionTerminalEffective(facts.merchantStorageActive, facts) &&
      !facts.hasRealOperatorScan &&
      !facts.inWarehouseStartTime &&
      !facts.lastDispatchedOutTime &&
      !facts.assignCancelLoopWithoutDispatch &&
      result.lossScope !== '需人工判断',
    resolve: ({ result, facts }) => {
      const hit = `当前责任段为公司仓库 ${facts.activeWarehouseName ?? '-'}，但缺少真实操作员扫描、回仓、盘点或真正出库起算证据；证据不足不能归入「暂无异常」`
      return withRuleHit({
        result,
        ruleId: 'company_warehouse_missing_basis_needs_review',
        lossScope: '需人工判断',
        confidence: Math.min(result.confidence, 0.6),
        needsReview: true,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'active_in_warehouse_overdue_is_in_warehouse_loss',
    priority: 27,
    description: '当前公司仓库在库责任段已满足库内丢失事实条件时，纠正模型的暂无异常或其他误判。',
    match: ({ result, facts }) =>
      facts.activeResponsibilityOwner === 'company_warehouse' &&
      facts.activeSegmentStatus === 'in_warehouse' &&
      facts.activeWarehouseKnown &&
      !isDirectionTerminalEffective(facts.merchantDestroyConfirmed, facts) &&
      !isDirectionTerminalEffective(facts.merchantAbandonActive, facts) &&
      !facts.merchantReturnClosed &&
      !isDirectionTerminalEffective(facts.merchantStorageActive, facts) &&
      facts.hasRealOperatorScan &&
      facts.finalResponsibilityOwner === 'in_warehouse' &&
      !facts.hasDeliveryCompletion &&
      facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays &&
      result.lossScope !== '库外丢失' &&
      result.lossScope !== '库内丢失',
    resolve: ({ result, facts }) => {
      const hit = `当前责任段为公司仓库 ${facts.activeWarehouseName ?? '-'} 在库，最终库内责任点距今 ${facts.finalResponsibilityDaysDiff} 天，已满足库内丢失事实条件`
      return withRuleHit({
        result,
        ruleId: 'active_in_warehouse_overdue_is_in_warehouse_loss',
        lossScope: '库内丢失',
        exceptionCategoryId: inWarehouseLossSubType(facts),
        confidence: Math.max(0.85, result.confidence),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'merchant_return_in_progress_not_terminal',
    priority: 28,
    description: '商家最新有效方向不是退返/退回商家时，不得沿用旧的退返商家子类型。',
    match: ({ result, facts }) =>
      !facts.merchantReturnDirectionActive &&
      facts.merchantReturnRequested &&
      !facts.merchantReturnClosed &&
      facts.activeResponsibilityOwner === 'company_warehouse' &&
      facts.activeSegmentStatus === 'in_warehouse' &&
      result.exceptionCategoryId === '退返商家',
    resolve: ({ result, facts }) => {
      const expectedScope = expectedScopeFromFinalResponsibility(facts)
      const hit = `商家最新有效处理方向不是退返/退回商家，不能沿用「退返商家」子类型；应回到当前责任段最终责任点判断`
      if (expectedScope === '库内丢失') {
        return withRuleHit({
          result,
          ruleId: 'merchant_return_in_progress_not_terminal',
          lossScope: '库内丢失',
          exceptionCategoryId: inWarehouseLossSubType(facts),
          confidence: Math.max(0.85, result.confidence),
          needsReview: false,
          hit,
          reason: `[事实校验纠正] ${hit}，最终库内责任点距今 ${facts.finalResponsibilityDaysDiff} 天，已达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值。原始判断: ${result.reason}`,
        })
      }
      if (expectedScope === '库外丢失') {
        return withRuleHit({
          result,
          ruleId: 'merchant_return_in_progress_not_terminal',
          lossScope: '库外丢失',
          exceptionCategoryId: '快递员丢失',
          confidence: Math.max(0.85, result.confidence),
          needsReview: false,
          hit,
          reason: `[事实校验纠正] ${hit}，最终库外责任点距今 ${facts.finalResponsibilityDaysDiff} 天，已达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值。原始判断: ${result.reason}`,
        })
      }
      return withRuleHit({
        result,
        ruleId: 'merchant_return_in_progress_not_terminal',
        lossScope: expectedScope ?? '需人工判断',
        exceptionCategoryId: expectedScope === '暂无异常' ? noExceptionSubTypeFromFacts(facts) : '',
        confidence: expectedScope === '暂无异常' ? Math.min(result.confidence, 0.78) : Math.min(result.confidence, 0.6),
        needsReview: expectedScope !== '暂无异常',
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'no_real_operator_cannot_be_in_warehouse_loss',
    priority: 30,
    description: '无真实操作员扫描入库且全程无真正出库时，禁止判定库内丢失；若存在无出库分配-取消循环则归为虚假转运。',
    appliesTo: ['库内丢失'],
    match: ({ facts }) => !facts.hasRealOperatorScan && facts.lastDispatchedOutTime === null,
    resolve: ({ result, facts }) => {
      const correctedScope: AiLossScope = facts.assignCancelLoopWithoutDispatch ? '虚假转运' : '需人工判断'
      const hit = '当前责任段无真实操作员扫描入库记录，且全程无「包裹正在派送中」真正出库，责任尚未真正进入库内，不满足库内丢失必要条件①'
      return withRuleHit({
        result,
        ruleId: 'no_real_operator_cannot_be_in_warehouse_loss',
        lossScope: correctedScope,
        confidence: correctedScope === '虚假转运' ? Math.max(0.85, result.confidence) : Math.min(result.confidence, 0.4),
        needsReview: correctedScope !== '虚假转运',
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'in_warehouse_loss_threshold_not_met',
    priority: 40,
    description: '库内丢失必须满足当前仓库超时阈值，或无成功出库分配-取消循环且库内起算至少 5 天。',
    appliesTo: ['库内丢失'],
    match: ({ facts }) =>
      facts.finalResponsibilityOwner === 'in_warehouse' &&
      facts.finalResponsibilityDaysDiff >= 0 &&
      facts.finalResponsibilityDaysDiff < facts.activeWarehouseLossTimeoutDays,
    resolve: ({ result, facts }) => {
      const hit = `最终库内责任点距今仅 ${facts.finalResponsibilityDaysDiff} 天，未达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值`
      return withRuleHit({
        result,
        ruleId: 'in_warehouse_loss_threshold_not_met',
        lossScope: '暂无异常',
        exceptionCategoryId: noExceptionSubTypeFromFacts(facts),
        confidence: Math.max(0.78, Math.min(result.confidence, 0.92)),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'intercept_updates_responsibility_start',
    priority: 41,
    description: '正常轨迹与阻断日志按时间线合并后，必须基于最后责任点重新判断当前仓库超时阈值。',
    match: ({ result, facts }) =>
      facts.activeResponsibilityOwner === 'company_warehouse' &&
      !facts.hasDeliveryCompletion &&
      !isDirectionTerminalEffective(facts.merchantDestroyConfirmed, facts) &&
      !isDirectionTerminalEffective(facts.merchantAbandonActive, facts) &&
      !facts.merchantReturnClosed &&
      !isDirectionTerminalEffective(facts.merchantStorageActive, facts) &&
      facts.finalResponsibilityOwner !== null &&
      facts.finalResponsibilityStartTime !== null &&
      (() => {
        const expectedScope = expectedScopeFromFinalResponsibility(facts)
        if (!expectedScope) return false
        if (expectedScope === '暂无异常') {
          if (facts.finalResponsibilityOwner === 'in_warehouse') return result.lossScope === '库外丢失'
          if (facts.finalResponsibilityOwner === 'out_warehouse') return result.lossScope === '库内丢失'
          return false
        }
        return result.lossScope !== expectedScope
      })(),
    resolve: ({ result, facts }) => {
      const owner = facts.finalResponsibilityOwner
      const days = facts.finalResponsibilityDaysDiff
      const timeoutDays = facts.activeWarehouseLossTimeoutDays
      const hit = `${facts.finalResponsibilityBasis ?? '当前责任段最终责任点'}；最终起算距今 ${days} 天`
      if (owner === 'out_warehouse' && days >= timeoutDays) {
        return withRuleHit({
          result,
          ruleId: 'intercept_updates_responsibility_start',
          lossScope: '库外丢失',
          exceptionCategoryId: '快递员丢失',
          confidence: Math.max(0.85, result.confidence),
          needsReview: false,
          hit,
          reason: `[事实校验纠正] ${hit}，已达到当前仓库 ${timeoutDays} 天阈值，判定为库外丢失。原始判断: ${result.reason}`,
        })
      }
      if (owner === 'in_warehouse' && days >= timeoutDays) {
        return withRuleHit({
          result,
          ruleId: 'intercept_updates_responsibility_start',
          lossScope: '库内丢失',
          exceptionCategoryId: inWarehouseLossSubType(facts),
          confidence: Math.max(0.85, result.confidence),
          needsReview: false,
          hit,
          reason: `[事实校验纠正] ${hit}，已达到当前仓库 ${timeoutDays} 天阈值，判定为库内丢失。原始判断: ${result.reason}`,
        })
      }
      return withRuleHit({
        result,
        ruleId: 'intercept_updates_responsibility_start',
        lossScope: '暂无异常',
        exceptionCategoryId: noExceptionSubTypeFromFacts(facts),
        confidence: Math.min(result.confidence, 0.65),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}，未达到当前仓库 ${timeoutDays} 天阈值，暂不判定库内/库外丢失。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'known_warehouse_not_overdue_clears_manual_review',
    priority: 41.5,
    description: '当前仓库已配置且最终责任点明确未超阈值时，避免模型过度保守输出需人工判断。',
    appliesTo: ['需人工判断'],
    match: ({ facts }) =>
      facts.activeResponsibilityOwner === 'company_warehouse' &&
      facts.activeWarehouseKnown &&
      !facts.unknownWarehouseInActiveSegment &&
      !isDirectionTerminalEffective(facts.merchantDestroyConfirmed, facts) &&
      !isDirectionTerminalEffective(facts.merchantAbandonActive, facts) &&
      !facts.merchantReturnClosed &&
      !isDirectionTerminalEffective(facts.merchantStorageActive, facts) &&
      facts.finalResponsibilityOwner !== null &&
      facts.finalResponsibilityStartTime !== null &&
      facts.finalResponsibilityDaysDiff >= 0 &&
      facts.finalResponsibilityDaysDiff < facts.activeWarehouseLossTimeoutDays,
    resolve: ({ result, facts }) => {
      const hit = `${facts.finalResponsibilityBasis ?? '当前责任段最终责任点'}；最终起算距今 ${facts.finalResponsibilityDaysDiff} 天，未达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值`
      return withRuleHit({
        result,
        ruleId: 'known_warehouse_not_overdue_clears_manual_review',
        lossScope: '暂无异常',
        exceptionCategoryId: noExceptionSubTypeFromFacts(facts),
        confidence: Math.min(result.confidence, 0.65),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}，当前仓库已完成配置且责任点明确，无需进入人工判断。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'active_dispatch_out_overdue_is_out_warehouse_loss',
    priority: 40.8,
    description: '当前责任段已有真正出库且未回仓，库外起算达到当前仓库超时阈值时，按库外丢失处理。',
    match: ({ result, facts }) =>
      facts.activeResponsibilityOwner === 'company_warehouse' &&
      facts.lastDispatchedOutTime !== null &&
      !facts.lastDispatchHasReturn &&
      !facts.hasDeliveryCompletion &&
      facts.outWarehouseDaysDiff >= facts.activeWarehouseLossTimeoutDays &&
      result.lossScope !== '库外丢失',
    resolve: ({ result, facts }) => {
      const hit = `当前责任段存在「包裹正在派送中」真正出库（${facts.lastDispatchedOutTime}），最近一次出库后无回仓/盘点，库外起算距今 ${facts.outWarehouseDaysDiff} 天，责任已转移到库外`
      return withRuleHit({
        result,
        ruleId: 'active_dispatch_out_overdue_is_out_warehouse_loss',
        lossScope: '库外丢失',
        exceptionCategoryId: '快递员丢失',
        confidence: Math.max(0.9, result.confidence),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}，已达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值，判定为库外丢失。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'active_dispatch_blocks_in_warehouse_loss',
    priority: 40.9,
    description: '当前责任段已有真正出库且未回仓时，库内责任已转移，禁止判库内丢失。',
    appliesTo: ['库内丢失'],
    match: ({ facts }) =>
      facts.activeResponsibilityOwner === 'company_warehouse' &&
      facts.lastDispatchedOutTime !== null &&
      !facts.lastDispatchHasReturn &&
      !facts.hasDeliveryCompletion,
    resolve: ({ result, facts }) => {
      const hit = `当前责任段存在「包裹正在派送中」真正出库（${facts.lastDispatchedOutTime}），且最近一次出库后无回仓/盘点；库内责任已转移到库外`
      return withRuleHit({
        result,
        ruleId: 'active_dispatch_blocks_in_warehouse_loss',
        lossScope: '暂无异常',
        exceptionCategoryId: noExceptionSubTypeFromFacts(facts),
        confidence: Math.min(result.confidence, 0.65),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}，但库外起算距今 ${facts.outWarehouseDaysDiff} 天，未达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值，暂不判定库内/库外丢失。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'out_warehouse_loss_after_return',
    priority: 44,
    description: '最近一次出库后已有回站/盘点记录时，库外丢失必要条件不成立。',
    appliesTo: ['库外丢失'],
    match: ({ facts }) => facts.lastDispatchHasReturn && facts.finalResponsibilityOwner !== 'out_warehouse',
    resolve: ({ result, facts }) => {
      const hit = '「最近一次出库后已有回站/盘点记录」= 是，包裹已回仓，库外丢失必要条件③不满足'
      const expectedScope = expectedScopeFromFinalResponsibility(facts)
      if (expectedScope === '库内丢失') {
        return withRuleHit({
          result,
          ruleId: 'out_warehouse_loss_after_return',
          lossScope: '库内丢失',
          exceptionCategoryId: inWarehouseLossSubType(facts),
          confidence: Math.max(0.85, result.confidence),
          needsReview: false,
          hit,
          reason: `[事实校验纠正] ${hit}；最终责任点已回到库内且距今 ${facts.finalResponsibilityDaysDiff} 天，达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值，判定为库内丢失。原始判断: ${result.reason}`,
        })
      }
      return withRuleHit({
        result,
        ruleId: 'out_warehouse_loss_after_return',
        lossScope: expectedScope ?? '需人工判断',
        exceptionCategoryId: expectedScope === '暂无异常' ? noExceptionSubTypeFromFacts(facts) : '',
        confidence: expectedScope === '暂无异常' ? Math.max(0.78, Math.min(result.confidence, 0.92)) : Math.min(result.confidence, 0.55),
        needsReview: expectedScope !== '暂无异常',
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'out_warehouse_loss_threshold_not_met',
    priority: 45,
    description: '库外丢失必须满足当前仓库超时阈值。',
    appliesTo: ['库外丢失'],
    match: ({ facts }) =>
      facts.finalResponsibilityOwner === 'out_warehouse' &&
      facts.finalResponsibilityDaysDiff >= 0 &&
      facts.finalResponsibilityDaysDiff < facts.activeWarehouseLossTimeoutDays,
    resolve: ({ result, facts }) => {
      const hit = `最终库外责任点距今仅 ${facts.finalResponsibilityDaysDiff} 天，未达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值`
      return withRuleHit({
        result,
        ruleId: 'out_warehouse_loss_threshold_not_met',
        lossScope: '暂无异常',
        confidence: Math.min(result.confidence, 0.45),
        needsReview: false,
        hit,
        reason: `[事实校验纠正] ${hit}，暂不判定库外丢失。原始判断: ${result.reason}`,
      })
    },
  },
  {
    id: 'fake_transfer_has_real_operator',
    priority: 46,
    description: '只要存在真实操作员扫描或盘点，就排除虚假转运。',
    appliesTo: ['虚假转运'],
    match: ({ facts }) => facts.hasRealOperatorScan,
    resolve: ({ result, facts }) => {
      const hit = '轨迹存在真实操作员扫描记录，包裹已真正入库，不满足虚假转运必要条件②'
      const expectedScope = expectedScopeFromFinalResponsibility(facts)
      if (expectedScope === '库内丢失') {
        return withRuleHit({
          result,
          ruleId: 'fake_transfer_has_real_operator',
          lossScope: '库内丢失',
          exceptionCategoryId: inWarehouseLossSubType(facts),
          confidence: Math.max(0.85, result.confidence),
          needsReview: false,
          hit,
          reason: `[事实校验纠正] ${hit}；最终库内责任点距今 ${facts.finalResponsibilityDaysDiff} 天，已达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值。原始判断: ${result.reason}`,
        })
      }
      if (expectedScope === '库外丢失') {
        return withRuleHit({
          result,
          ruleId: 'fake_transfer_has_real_operator',
          lossScope: '库外丢失',
          exceptionCategoryId: '快递员丢失',
          confidence: Math.max(0.85, result.confidence),
          needsReview: false,
          hit,
          reason: `[事实校验纠正] ${hit}；最终库外责任点距今 ${facts.finalResponsibilityDaysDiff} 天，已达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值。原始判断: ${result.reason}`,
        })
      }
      return withRuleHit({
        result,
        ruleId: 'fake_transfer_has_real_operator',
        lossScope: expectedScope ?? '需人工判断',
        exceptionCategoryId: expectedScope === '暂无异常' ? noExceptionSubTypeFromFacts(facts) : '',
        confidence: expectedScope === '暂无异常' ? Math.max(0.78, Math.min(result.confidence, 0.92)) : Math.min(result.confidence, 0.55),
        needsReview: expectedScope !== '暂无异常',
        hit,
        reason: `[事实校验纠正] ${hit}。原始判断: ${result.reason}`,
      })
    },
  },
] as const

export function applyFactGuardrails(result: OrderAnalyzeResult, facts: TrackFacts): OrderAnalyzeResult {
  const normalizedRules = [...DECISION_RULES].sort((a, b) => a.priority - b.priority)
  // 方向指令仅在有物理支撑或尚未超时时锁定终态；无物理支撑且已超时时放行超时检测规则
  const terminalScopeLocked =
    facts.latestOrderExceptionClosed ||
    isDirectionTerminalEffective(facts.merchantDestroyConfirmed, facts) ||
    isDirectionTerminalEffective(facts.merchantAbandonActive, facts) ||
    isDirectionTerminalEffective(facts.merchantStorageActive, facts) ||
    facts.merchantReturnClosed ||
    facts.hasDeliveryCompletion

  if (terminalScopeLocked) {
    const terminalRule = normalizedRules.find(
      (rule) => TERMINAL_RULE_IDS.has(rule.id) && appliesToResult(rule, result) && rule.match({ result, facts })
    )
    return terminalRule ? terminalRule.resolve({ result, facts }) : result
  }

  const matchedRule = normalizedRules.find(
    (rule) => !TERMINAL_RULE_IDS.has(rule.id) && appliesToResult(rule, result) && rule.match({ result, facts })
  )
  return matchedRule ? matchedRule.resolve({ result, facts }) : result
}

export function classifyOrderFromFacts(input: {
  orderNo: string
  facts: TrackFacts
}): OrderAnalyzeResult {
  const baseResult = buildDeterministicBaseResult(input)
  return applyFactGuardrails(baseResult, input.facts)
}

export function buildFactGuardrailPromptText(): string {
  return [...DECISION_RULES]
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => `- ${rule.id}: ${rule.description}`)
    .join('\n')
}
