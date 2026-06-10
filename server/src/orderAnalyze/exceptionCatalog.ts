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
      '满足真实操作员扫描入库、未真正出库或已回仓、无正常完结，且达到库内超时或无成功出库的分配-取消循环阈值。',
    subTypes: [
      {
        id: '扫描员丢失',
        promptDescription: '真实操作员扫描入库后，包裹仍在库内责任域内超时或满足无成功出库的分配-取消循环。',
        inferFromFacts: (facts) =>
          (facts.hasRealOperatorScan &&
            facts.finalResponsibilityOwner === 'in_warehouse' &&
            facts.finalResponsibilityDaysDiff >= 0 &&
            (facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays ||
              (facts.assignCancelLoopWithoutDispatch && facts.finalResponsibilityDaysDiff >= 5))),
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
        id: 'Abandon销毁',
        promptDescription:
          'lossScope 为「暂无异常」且轨迹命中商家 Abandon 处理指令（退件处理意见[Abandon] / NDR处理意见[Abandon]）或退件已销毁物理闭环，且 Abandon 是当前最新商家反馈。与中文「NDR销毁」语义等同，统一使用此子类型。',
        aliases: ['abandon', 'abandon销毁', '销毁'],
        inferFromFacts: (facts) => facts.merchantAbandonActive || facts.merchantDestroyConfirmed,
      },
      {
        id: '退返商家',
        promptDescription: 'lossScope 为「暂无异常」，且当前最新有效商家处理方向为退返/退回商家；包含已退返商家/商家签收等闭环，也包含商家反馈意见[退返商家]但尚未闭环的处理方向。若后续最新反馈改为 Abandon/销毁/暂存/其他退件方向，则以最新方向为准。',
        aliases: ['退回商家'],
        inferFromFacts: (facts) =>
          (facts.merchantReturnClosed || facts.merchantReturnDirectionActive) &&
          !facts.latestOrderExceptionClosed &&
          !facts.hasDeliveryCompletion &&
          !facts.merchantAbandonActive &&
          !facts.merchantDestroyConfirmed &&
          !facts.merchantStorageActive,
      },
      {
        id: '暂存',
        promptDescription: 'lossScope 为「暂无异常」且轨迹命中商家暂存闭环，后续未出现预约派送或新的业务推进。',
        inferFromFacts: (facts) => facts.merchantStorageActive,
      },
      {
        id: '订单已完结',
        promptDescription: 'lossScope 为「暂无异常」且最新轨迹为「订单异常完结，原因【...】。操作员【...】」终态闭环。',
        inferFromFacts: (facts) => facts.latestOrderExceptionClosed,
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
