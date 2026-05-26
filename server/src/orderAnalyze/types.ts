import type { TrackEvent } from '../imile/track'
import type { ScanInterceptLog } from '../imile/interceptLogs'

/** 模型输出必须是六者之一（四类异常责任 + 暂无异常 + 需人工判断） */
export type AiLossScope =
  | '库内丢失'
  | '库外丢失'
  | '3PL丢件'
  | '虚假转运'
  | '暂无异常'
  | '需人工判断'

export type AnalyzeTarget = {
  orderNo: string
  tracks: TrackEvent[]
  interceptLogs?: ScanInterceptLog[]
}

export type WarehouseCityId = 'ADL' | 'MEL' | 'PER' | 'SYD' | 'BNE' | 'QLD'

/** 真实操作员匹配规则：正则表达式或精确账号名（大小写不敏感） */
export type RealOperatorPattern = RegExp | string

export type WarehouseProfile = {
  cityId: WarehouseCityId
  hubId: string
  displayName: string
  aliases: readonly string[]
  realOperatorPatterns: readonly RealOperatorPattern[]
  /** 当前仓库库内/库外丢失判定超时天数；未配置时使用系统默认值 */
  lossTimeoutDays?: number
  nonRealOperators?: readonly string[]
  nonRealOperatorPatterns?: readonly RegExp[]
  systemOperators?: readonly string[]
}

export type OperatorClassification = 'real' | 'non_real' | 'system' | 'unknown'

export type ResponsibilityOwner = 'company_warehouse' | 'external_carrier' | 'merchant' | 'unknown'

export type ResponsibilitySegmentStatus =
  | 'in_warehouse'
  | 'out_warehouse'
  | 'transit_to_company_hub'
  | 'external_carrier'
  | 'merchant_terminal'
  | 'unknown'

export type ResponsibilitySegment = {
  owner: ResponsibilityOwner
  status: ResponsibilitySegmentStatus
  startTime: string
  endTime: string | null
  startReason: string
  endReason: string | null
  hubId: string | null
  hubName: string | null
  cityId: WarehouseCityId | null
  warehouseKnown: boolean
  carrierName: string | null
  eventCount: number
}

export type LossResponsibilityOwner = 'in_warehouse' | 'out_warehouse'

export type ResponsibilityTrackMarker = {
  source: 'track' | 'intercept'
  owner: LossResponsibilityOwner
  time: string
}

export type OrderAnalyzeResult = {
  orderNo: string
  lossScope: AiLossScope
  exceptionCategoryId: string
  /** 当前包裹责任方，由服务端责任段事实派生，不由模型自由生成 */
  currentResponsibilityParty?: string
  /** 当前责任主体（供前端闭环判型用） */
  activeResponsibilityOwner?: ResponsibilityOwner
  /** 最新责任方对应的责任点锚点（用于前端在轨迹/阻断中高亮） */
  latestResponsibilityTrackMarker?: ResponsibilityTrackMarker | null
  reason: string
  confidence: number
  /** 事实硬校验后需要人工复核 */
  needsReview?: boolean
  /** 交叉验证所用的反向 provider */
  crossCheckedBy?: 'openai' | 'deepseek' | null
  /** 命中的事实校验规则描述（供前端展示） */
  factGuardrailHit?: string
  /** 命中的服务端确定性规则 id（用于排查规则优先级与生产问题） */
  appliedDecisionRuleId?: string
}

/**
 * 从轨迹事件中预计算出的结构化事实。
 * 作为 `applyFactGuardrails` 与 `computeTrackTemporalContext` 的共同数据源。
 */
export type TrackFacts = {
  todayStr: string
  lastEventTime: string
  lastEventDaysDiff: number
  responsibilitySegments: ResponsibilitySegment[]
  activeSegment: ResponsibilitySegment | null
  activeResponsibilityOwner: ResponsibilityOwner
  activeSegmentStatus: ResponsibilitySegmentStatus
  activeWarehouseHubId: string | null
  activeWarehouseName: string | null
  activeWarehouseCityId: WarehouseCityId | null
  activeWarehouseKnown: boolean
  /** 当前仓库库内/库外丢失判定超时天数，默认 7 天 */
  activeWarehouseLossTimeoutDays: number
  activeExternalCarrierName: string | null
  activeSegmentStartTime: string | null
  activeSegmentDaysDiff: number
  unknownWarehouseInActiveSegment: boolean
  externalCarrierTransferTime: string | null
  externalCarrierDaysDiff: number
  /** 库内超时起算时间（ISO 字符串），null 表示无法确定 */
  inWarehouseStartTime: string | null
  inWarehouseBasis: string | null
  /** 库内起算距今天数，-1 表示无法确定 */
  inWarehouseDaysDiff: number
  /** 库内起算之后是否存在「包裹正在派送中」真实出库事件 */
  inWarehouseStartSupersededByDispatch: boolean
  /** 是否存在任何取消分配记录（仅表示存在，非全程无出库的循环） */
  hasDeliveryCancellations: boolean
  /** 是否存在仓内真实操作员扫描/盘点记录，不包含派件员二次出库扫描 */
  hasRealOperatorScan: boolean
  /** 是否已有签收、妥投、派件完成等正常完结记录 */
  hasDeliveryCompletion: boolean
  /** 最新正常完结事件时间（签收/妥投/派件完成），null 表示未命中 */
  deliveryCompletionTime: string | null
  /** 最新正常完结事件证据（stage/content 摘要） */
  deliveryCompletionEvidence: string | null
  /** 最近一次「包裹正在派送中」出库时间（ISO 字符串），null 表示从未出库 */
  lastDispatchedOutTime: string | null
  /** 库外起算距今天数，-1 表示无法确定 */
  outWarehouseDaysDiff: number
  /** 最近一次出库后是否已有回站/盘点记录（包裹是否已回仓） */
  lastDispatchHasReturn: boolean
  /** 最近一次「派送任务已分配」时间晚于最近一次「包裹正在派送中」（说明当前仍在仓内待出库） */
  latestAssignmentAfterLastDispatch: boolean
  deliveryAssignmentCount: number
  deliveryCancelCount: number
  problemCount: number
  lastInventoryTime: string | null
  lastInventoryDaysDiff: number
  /**
   * 「分配-取消循环无任何成功出库」= 多次分配 + 几乎全部取消 + 全程从未出现「包裹正在派送中」。
   * 这是库内丢失充分条件 (b) 的直接对应标志。
   * 出库后已回仓再发起的新一轮分配-取消，**不**触发此标志。
   */
  assignCancelLoopWithoutDispatch: boolean
  /** 承运商完结标记含「站内丢包/站点丢失」关键词 */
  stationLossCompletion: boolean
  /** 过滤 cornerstone 后是否存在阻断日志 */
  hasInterceptLogs: boolean
  /** 最新可解析 gmtIntercept 的阻断日志时间 */
  latestInterceptTime: string | null
  /** 最新阻断日志操作人账号 */
  latestInterceptUserCode: string | null
  /** 最新阻断日志操作人名称 */
  latestInterceptUserName: string | null
  /** 最新阻断日志操作人类型：派送员 / 扫描员 / 未知 */
  latestInterceptOperatorType: 'courier' | 'scanner' | 'unknown' | null
  /** 最新阻断日志是否晚于库内起算时间 */
  latestInterceptAfterInWarehouseStart: boolean
  /** 最新阻断日志是否晚于库外起算时间 */
  latestInterceptAfterOutWarehouseStart: boolean
  /** 阻断日志更新后的最终库内/库外责任归属；null 表示阻断日志未改变责任起算 */
  interceptAdjustedResponsibilityOwner: LossResponsibilityOwner | null
  /** 阻断日志更新后的最终责任起算时间 */
  interceptAdjustedResponsibilityStartTime: string | null
  /** 阻断日志更新后的最终责任起算距今天数，-1 表示未命中 */
  interceptAdjustedResponsibilityDaysDiff: number
  /** 阻断日志更新责任归属/起算的说明 */
  interceptAdjustedResponsibilityBasis: string | null
  /** 当前责任段内合并正常轨迹与阻断日志后的最终库内/库外责任归属 */
  finalResponsibilityOwner: LossResponsibilityOwner | null
  /** 当前责任段内最终责任点时间 */
  finalResponsibilityStartTime: string | null
  /** 当前责任段内最终责任点来源 */
  finalResponsibilitySource: 'track' | 'intercept' | null
  /** 当前责任段内最终责任点距今天数，-1 表示无法确定 */
  finalResponsibilityDaysDiff: number
  /** 当前责任段内最终责任点来源说明 */
  finalResponsibilityBasis: string | null
  /** 商家已明确反馈 NDR 销毁，且轨迹显示按销毁处理（终态闭环信号） */
  merchantDestroyConfirmed: boolean
  merchantDestroyConfirmTime: string | null
  merchantDestroyEvidence: string | null
  /** 商家已明确反馈暂存，且后续未出现预约派送（暂存闭环信号） */
  merchantStorageActive: boolean
  merchantStorageConfirmTime: string | null
  merchantStorageEvidence: string | null
  /** 暂存后是否已出现预约派送；出现后恢复当前仓库阈值判断 */
  merchantStorageReleasedBySchedule: boolean
  merchantStorageScheduleTime: string | null
  /** 暂存后是否出现明确业务推进（退件意见、装箱转运等）；出现后不再展示为「暂存包裹」 */
  merchantStorageSupersededByBusinessProgress: boolean
  merchantStorageBusinessProgressTime: string | null
  merchantStorageBusinessProgressEvidence: string | null
  /** 轨迹已进入退返/退回商家闭环或明确退件处理链路 */
  merchantReturnConfirmed: boolean
  merchantReturnConfirmTime: string | null
  merchantReturnEvidence: string | null
  /** 商家已给出退返/退回处理方向，但尚未出现退返闭环 */
  merchantReturnRequested: boolean
  merchantReturnRequestTime: string | null
  merchantReturnRequestEvidence: string | null
  /** 退返商家方向后的集包节点，表示库内责任已转移出去 */
  merchantReturnResponsibilityTransferred: boolean
  merchantReturnResponsibilityTransferTime: string | null
  merchantReturnResponsibilityTransferEvidence: string | null
  /** 退返商家方向后的集包节点，兼容既有字段读取 */
  merchantReturnPackageTime: string | null
  merchantReturnPackageEvidence: string | null
  /** 已装箱且目的地为非 Adelaide Center，最新状态为该装箱事件本身或仍处于转运处理中 */
  transferToOtherHubInProgress: boolean
  transferToOtherHubTime: string | null
  transferToOtherHubDestination: string | null
  transferToOtherHubEvidence: string | null
  latestEventKind: string
}

export type ActionableLossScope = Exclude<AiLossScope, '暂无异常' | '需人工判断'>
