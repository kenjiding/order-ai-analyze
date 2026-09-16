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
  /** 分析基准时间；生产默认当前时间，回归用 fixture capturedAt 固定结果，避免日期漂移 */
  analysisDate?: string
}

export type WarehouseCityId = 'ADL' | 'MEL' | 'PER' | 'SYD' | 'BNE' | 'QLD' | 'CBR'

export type WarehouseProfile = {
  cityId: WarehouseCityId
  hubId: string
  /** 与轨迹【】内仓库名一致，分析匹配的主键 */
  name: string
  /** 轨迹中可能出现的其他写法，可选 */
  extraAliases?: readonly string[]
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

/**
 * 「分析结果」中与最新责任点相关的字段的统一载体：责任人/操作/时间/无操作天数
 * 均由服务端在同一处（pipeline.ts 的 buildLatestResponsibility）解析完成，
 * 避免前端再拿 time 去 trackInfo/interceptLogs 里反查、正则解析文案。
 */
export type LatestResponsibility = {
  source: 'track' | 'intercept'
  owner: LossResponsibilityOwner
  /** 责任点时间，用于在轨迹/阻断日志时间线中定位并高亮该条记录 */
  time: string
  /** 「最新责任时间」展示值；intercept 来源优先取 gmtScan，可能与 time 不同 */
  displayTime: string
  /** 「最新责任人」展示值，无法解析时为 '—' */
  person: string
  /** 「最新责任操作」展示值，无法解析时为 '—' */
  action: string
  /** 「无操作天数」，距今天数 */
  noOperationDays: number
}

export type OrderAnalyzeResult = {
  orderNo: string
  lossScope: AiLossScope
  exceptionCategoryId: string
  /** 当前包裹责任方，由服务端责任段事实派生，不由模型自由生成 */
  currentResponsibilityParty?: string
  /** 当前责任主体（供前端闭环判型用） */
  activeResponsibilityOwner?: ResponsibilityOwner
  /** 最新责任点：责任人/操作/时间/无操作天数，null 表示当前责任段内无可确定的责任点 */
  latestResponsibility?: LatestResponsibility | null
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
  /** 与判定无关的补充信息，由 pipeline 之后的富化阶段按需填充；缺失即表示无额外数据 */
  extraData?: OrderAnalyzeExtraData
}

export type OrderAnalyzeExtraDataEntry = { label: string; value: string }

/**
 * 「额外数据」通用载体：与判定结论无关的补充信息。
 * summary 用于表格列与 Excel 单元格，entries 用于详情抽屉里的结构化明细。
 */
export type OrderAnalyzeExtraData = {
  summary: string
  entries: OrderAnalyzeExtraDataEntry[]
}

/** 「分配→取消」配对中被分配的派件员；轨迹「分配」事件通常只有名字没有 ID。 */
export type FirstAssignCancelDriver = {
  driverName: string
  /** 轨迹里带 `ID: Dxxx` 时填，通常为空串 */
  driverId: string
  assignTime: string
  cancelTime: string
  /** 「取消分配给[X]」里的名字，用于与 driverName 做一致性校验 */
  cancelDriverName: string
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
  /** 当前仓库库内/库外丢失判定超时天数，默认 DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS（15 天） */
  activeWarehouseLossTimeoutDays: number
  /** 外部承运（3PL）交接后判「3PL丢件」的超时天数，默认与仓库丢失阈值一致 */
  externalCarrierLossTimeoutDays: number
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
  /** 是否存在仓内真实操作员扫描/盘点或外部承运商退件入仓确认记录，不含派件员二次出库扫描 */
  hasRealOperatorScan: boolean
  /** 是否已有签收、妥投、派件完成等正常完结记录 */
  hasDeliveryCompletion: boolean
  /** 最新正常完结事件时间（签收/妥投/派件完成），null 表示未命中 */
  deliveryCompletionTime: string | null
  /** 最新正常完结事件证据（stage/content 摘要） */
  deliveryCompletionEvidence: string | null
  /**
   * 正常完结（签收/妥投）是否晚于最新商家处理方向指令。
   * 商家 Abandon/退返/暂存后仍签收成功时为 true，按「以最新事实为准」应判已签收。
   * 无任何商家方向指令时，只要存在正常完结即为 true。
   */
  deliveryCompletionSupersedesMerchantDirection: boolean
  /** 最新轨迹是否为「订单异常完结，原因【...】。操作员【...】」 */
  latestOrderExceptionClosed: boolean
  /** 最新订单异常完结时间，null 表示未命中 */
  latestOrderExceptionClosedTime: string | null
  /** 最新订单异常完结证据 */
  latestOrderExceptionClosedEvidence: string | null
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
  /**
   * 「最后一次库内实物确认之后出现过分配-取消配对，且此后未再成功出库」
   * = 以 inWarehouseStartTime（最近一次回仓/盘点/入库扫描）为起算点，其后至少 1 组「分配→取消」
   *   + 其后无「包裹正在派送中」。起算点之前的配对已被该次实物确认洗清嫌疑，不计入。
   * 仅用于把库内丢失的子类型定为「疑似派件员窃取」；不参与是否构成丢失的判定。
   * 与 assignCancelLoopWithoutDispatch（全轨迹历史最大连续 ≥2 组）区分：虚假转运等规则仍走后者。
   */
  assignCancelPairWithoutDispatch: boolean
  /**
   * 最后一次库内实物确认（盘点/回站/到仓，即 inWarehouseStartTime）之后，
   * 第一个「分配→取消」配对的派件员。该时点之前被分配又取消的司机已被盘点洗清嫌疑，故不取。
   *
   * ⚠️ 仅用于「额外数据」展示与追责线索，**不参与任何判定**：
   * 不得出现在 decisionRules 的规则条件、exceptionCatalog 的 inferFromFacts，
   * 也不得写进喂给模型的时序文本（computeTrackTemporalContext）。
   */
  firstAssignCancelDriver: FirstAssignCancelDriver | null
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
  /**
   * 商家 Abandon 指令已给出（退件处理意见[Abandon]）或退件已销毁物理闭环，
   * 且是当前最新的商家反馈（晚于暂存和退返所有事件）。
   * 与 merchantDestroyConfirmed（中文 NDR销毁）独立追踪。
   */
  merchantAbandonActive: boolean
  /** Abandon 反馈事件时间（首个方向事件或最新闭环事件，以最新为准） */
  merchantAbandonConfirmTime: string | null
  /** Abandon 反馈证据摘要 */
  merchantAbandonEvidence: string | null
  /** 退件已销毁物理销毁闭环是否出现 */
  merchantAbandonClosed: boolean
  merchantAbandonClosedTime: string | null
  merchantAbandonClosedEvidence: string | null
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
  /** 当前最新有效商家状态为退返/退回商家闭环 */
  merchantReturnClosed: boolean
  merchantReturnClosedTime: string | null
  merchantReturnClosedEvidence: string | null
  /** 当前最新有效商家处理方向为退返/退回商家；只用于暂无异常子类型，不作为终态闭环 */
  merchantReturnDirectionActive: boolean
  /** 商家已给出退返/退回处理方向，但尚未出现退返闭环 */
  merchantReturnRequested: boolean
  merchantReturnRequestTime: string | null
  merchantReturnRequestDaysDiff: number
  merchantReturnRequestEvidence: string | null
  /** 退返处理方向后的最新业务推进（含退件中、开始退回、装箱转运等） */
  merchantReturnLatestProgressTime: string | null
  merchantReturnLatestProgressDaysDiff: number
  merchantReturnLatestProgressEvidence: string | null
  /** 退返处理已进入转运但尚未闭环；最终结论仍以当前责任段最终责任点为准 */
  merchantReturnTransferInProgress: boolean
  /**
   * 最新商家处理方向（暂存/Abandon销毁/退返商家）之后，包裹是否已回到履约流程
   * （预约派送 / 真出库 / 分配给派件员）。为 true 时方向失效，恢复库内/库外超时判断。
   * 盘点、收退件等原地实物确认不算解冻——暂存后的盘点本就是为了挑出要退返的包裹。
   */
  merchantDirectionUnfrozen: boolean
  /**
   * 暂存冻结是否仍然生效：商家给出暂存后库内时钟停摆，直到包裹回到履约流程。
   * 冻结期内不适用任何库内/库外超时，也不需要靠持续盘点来续命。
   */
  merchantStorageFreezeActive: boolean
  /**
   * 释放暂存冻结的是否为退返方向。为 true 时超时起算点与阈值都切到退返口径
   * （从退返事件起算 + 「分析配置」的退返时效），冻结期间的滞留不予追认。
   * 非暂存路径的退返不适用：仓库已累积的滞留照常追责。
   */
  merchantStorageReleasedByReturn: boolean
  latestEventKind: string
}

export type ActionableLossScope = Exclude<AiLossScope, '暂无异常' | '需人工判断'>
