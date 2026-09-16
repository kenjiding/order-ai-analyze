import type { AiLossScope, TrackFacts } from './types'
import { EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS } from './warehouseProfiles'

export const AI_LOSS_SCOPE_VALUES = [
  '库内丢失',
  '库外丢失',
  '3PL丢件',
  '虚假转运',
  '暂无异常',
  '需人工判断',
] as const satisfies readonly AiLossScope[]

export type ExceptionSubTypeDefinition = {
  id: string
  promptDescription: string
  aliases?: readonly string[]
  inferFromFacts?: (facts: TrackFacts) => boolean
}

type ExceptionScopeDefinition = {
  lossScope: AiLossScope
  promptDescription: string
  subTypes: readonly ExceptionSubTypeDefinition[]
}

export const EXCEPTION_CATALOG: readonly ExceptionScopeDefinition[] = [
  {
    lossScope: '库内丢失',
    promptDescription:
      '满足真实操作员扫描入库、未真正出库或已回仓、无正常完结，且最终库内责任点距今达到当前仓库「仓库丢失超时（天）」阈值。',
    subTypes: [
      {
        id: '退返超时',
        promptDescription:
          '商家给出退返/退回商家方向前该单处于暂存冻结（暂存期间不计库内超时），退返方向释放冻结后从退返事件起算已达「分析配置」的退返商家时效仍未闭环。超期会被商家罚款，责任在仓库未及时盘出并退回，故仍归库内丢失，但子类型区分于单纯滞留。',
        aliases: ['退返商家超时', '退回超时'],
        inferFromFacts: (facts) =>
          facts.hasRealOperatorScan &&
          facts.merchantStorageReleasedByReturn &&
          facts.merchantReturnDirectionActive &&
          !facts.merchantReturnClosed &&
          facts.finalResponsibilityOwner === 'in_warehouse' &&
          facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays,
      },
      {
        id: '疑似派件员窃取',
        promptDescription:
          '已达到库内超时阈值，且最近一次库内实物确认（回仓/盘点/入库扫描）之后出现过至少 1 组「分配→取消」配对、此后未再真正出库；即包裹被实物确认在仓后由派件员领走又取消，从此再无任何真实操作记录。问题指向具体派件员而非仓库扫描员单纯滞留超时。该实物确认点之前的分配-取消已被洗清嫌疑，不计入。',
        inferFromFacts: (facts) =>
          (facts.hasRealOperatorScan &&
            facts.finalResponsibilityOwner === 'in_warehouse' &&
            facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays &&
            facts.assignCancelPairWithoutDispatch),
      },
      {
        id: '扫描员丢失',
        promptDescription: '真实操作员扫描入库后，包裹仍在库内责任域内达到超时阈值，且最近一次库内实物确认之后不存在「分配→取消」配对（含"配对都发生在该次实物确认之前、已被洗清"的情形）。',
        inferFromFacts: (facts) =>
          (facts.hasRealOperatorScan &&
            facts.finalResponsibilityOwner === 'in_warehouse' &&
            facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays &&
            !facts.assignCancelPairWithoutDispatch),
      },
    ],
  },
  {
    lossScope: '库外丢失',
    promptDescription:
      '包裹已通过「包裹正在派送中」真正出库，最近一次出库后未回仓，且库外起算达到当前仓库超时阈值仍无正常完结。',
    subTypes: [
      {
        id: '快递员丢失',
        promptDescription: '包裹已通过派送员二次扫描真正出库，最近一次出库后未回仓且库外超时。',
        inferFromFacts: (facts) =>
          facts.finalResponsibilityOwner === 'out_warehouse' &&
            facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays &&
            !facts.hasDeliveryCompletion &&
            (!facts.lastDispatchHasReturn || facts.interceptAdjustedResponsibilityOwner === 'out_warehouse'),
      },
    ],
  },
  {
    lossScope: '3PL丢件',
    promptDescription: `公司仓库已明确转交外部承运商，当前责任主体仍为 external_carrier，且最后更新达到 ${EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS} 天仍无正常完结或回到公司仓责任段。`,
    subTypes: [],
  },
  {
    lossScope: '虚假转运',
    promptDescription:
      '存在无任何成功出库的分配-取消循环，且当前责任段全程无任何真实库内/库外责任点（无真实扫描/回仓/盘点/出库/派送员/阻断扫描员），责任尚未真正进入库内。',
    subTypes: [],
  },
  {
    lossScope: '暂无异常',
    promptDescription:
      '规则已明确命中正常、闭环、未超阈值或非我司责任的状态；证据不足不得归入此类，应输出「需人工判断」。',
    subTypes: [
      {
        id: '订单已完结',
        promptDescription: 'lossScope 为「暂无异常」且最新轨迹为「订单异常完结，原因【...】。操作员【...】」终态闭环。',
        inferFromFacts: (facts) => facts.latestOrderExceptionClosed,
      },
      {
        id: '已签收',
        promptDescription:
          'lossScope 为「暂无异常」且轨迹命中签收/妥投/派件完成等正常履约完结，且该完结晚于最新商家处理方向。商家 Abandon/退返/暂存指令后仍签收成功的，同样以签收为准判此子类型。',
        aliases: ['签收', '签收成功', '妥投', '已妥投'],
        inferFromFacts: (facts) =>
          facts.deliveryCompletionSupersedesMerchantDirection && !facts.latestOrderExceptionClosed,
      },
      {
        id: 'Abandon销毁',
        promptDescription:
          'lossScope 为「暂无异常」且轨迹命中商家 Abandon 处理指令（退件处理意见[Abandon] / NDR处理意见[Abandon]）或退件已销毁物理闭环，且 Abandon 是当前最新商家反馈。与中文「NDR销毁」语义等同，统一使用此子类型。',
        aliases: ['abandon', 'abandon销毁', '销毁'],
        inferFromFacts: (facts) =>
          (facts.merchantAbandonActive || facts.merchantDestroyConfirmed) &&
          !facts.latestOrderExceptionClosed &&
          !facts.deliveryCompletionSupersedesMerchantDirection,
      },
      {
        id: '暂存',
        promptDescription: 'lossScope 为「暂无异常」且轨迹命中商家暂存闭环，后续未出现预约派送或新的业务推进。',
        inferFromFacts: (facts) =>
          facts.merchantStorageActive &&
          !facts.latestOrderExceptionClosed &&
          !facts.deliveryCompletionSupersedesMerchantDirection,
      },
      {
        id: '已退返商家',
        promptDescription:
          'lossScope 为「暂无异常」，且退返已物理闭环：轨迹出现「退件已退返商家」「已退返商家」、退回发件方/商家签收、退货妥投、退款退货闭环等。包裹已回到商家，该单终结；即使退返耗时超过退返商家时效，闭环后也不再标记超期。',
        aliases: ['已退回商家', '退返完成', '退返闭环'],
        inferFromFacts: (facts) =>
          facts.merchantReturnClosed &&
          !facts.latestOrderExceptionClosed &&
          !facts.deliveryCompletionSupersedesMerchantDirection &&
          !facts.merchantAbandonActive &&
          !facts.merchantDestroyConfirmed &&
          !facts.merchantStorageActive,
      },
      {
        id: '退返商家',
        promptDescription:
          'lossScope 为「暂无异常」，且当前最新有效商家处理方向为退返/退回商家但尚未闭环：商家反馈意见[退返商家] 已给出，包裹可能仍在盘点、装箱、转运途中。一旦出现退返物理闭环改用「已退返商家」；若后续最新反馈改为 Abandon/销毁/暂存/其他退件方向，则以最新方向为准。',
        aliases: ['退回商家'],
        inferFromFacts: (facts) =>
          facts.merchantReturnDirectionActive &&
          !facts.merchantReturnClosed &&
          !facts.latestOrderExceptionClosed &&
          !facts.deliveryCompletionSupersedesMerchantDirection &&
          !facts.merchantAbandonActive &&
          !facts.merchantDestroyConfirmed &&
          !facts.merchantStorageActive,
      },
    ],
  },
  {
    lossScope: '需人工判断',
    promptDescription: '用于仍处于责任链内但关键节点缺失、证据冲突或无法由确定性规则稳定判定的订单。',
    subTypes: [],
  },
] as const

const SCOPE_DEFINITION_BY_VALUE = new Map(EXCEPTION_CATALOG.map((item) => [item.lossScope, item]))

export function isAiLossScope(raw: unknown): raw is AiLossScope {
  return AI_LOSS_SCOPE_VALUES.includes(raw as AiLossScope)
}

export function normalizeLossScope(raw: unknown): AiLossScope {
  const s = String(raw ?? '').trim()
  if (s === '库内丢包') return '库内丢失'
  if (s === '库外丢包') return '库外丢失'
  if (s === '3PL丢失') return '3PL丢件'
  if (s === '退返商家') return '暂无异常'
  return isAiLossScope(s) ? s : '需人工判断'
}

function normalizeSubTypeText(raw: string): string {
  return raw.trim().toLowerCase()
}

export function normalizeSubType(input: {
  lossScope: AiLossScope
  subType?: string
  facts?: TrackFacts
}): string {
  const scopeDefinition = SCOPE_DEFINITION_BY_VALUE.get(input.lossScope)
  const subTypes = scopeDefinition?.subTypes ?? []
  if (!subTypes.length) return ''

  const raw = String(input.subType ?? '').trim()
  if (raw) {
    const normalizedRaw = normalizeSubTypeText(raw)
    const matched = subTypes.find((subType) => {
      if (normalizeSubTypeText(subType.id) === normalizedRaw) return true
      return (subType.aliases ?? []).some((alias) => normalizeSubTypeText(alias) === normalizedRaw)
    })
    if (matched) return matched.id
  }

  if (input.facts) {
    const inferred = subTypes.find((subType) => subType.inferFromFacts?.(input.facts as TrackFacts))
    if (inferred) return inferred.id
  }

  return ''
}

export function buildLossScopePromptText(): string {
  return EXCEPTION_CATALOG.map((item) => `——「${item.lossScope}」：${item.promptDescription}`).join('\n')
}

export function buildSubTypePromptText(): string {
  return EXCEPTION_CATALOG.map((item) => {
    if (!item.subTypes.length) return `- ${item.lossScope}: 当前无子类型；exceptionCategoryId 必须输出 ""。`
    const subTypeText = item.subTypes
      .map((subType) => `「${subType.id}」=${subType.promptDescription}`)
      .join('；')
    return `- ${item.lossScope}: ${subTypeText}`
  }).join('\n')
}
