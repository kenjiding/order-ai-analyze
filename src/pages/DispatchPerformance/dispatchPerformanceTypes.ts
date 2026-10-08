/**
 * 出仓派签达成分析的前端类型，形状与后端 dispatch24hStats/repository.ts 的查询返回一一对应。
 *
 * 两个率与四象限的关系（后端已算好，前端只展示，不再自己推）：
 *   24H 派签达标 = exitMetSignMet + exitUnmetSignMet
 *   11点前出仓达标 = exitMetSignMet + exitMetSignUnmet
 *   四象限之和 = total
 * 以上仅在 dispatchSettled 为 true 时成立；派签未结算时四象限全为 0、signRate 为 null。
 */

/** 四象限交叉计数：出仓是否达标 × 派签是否达标 */
export type DispatchQuadrant = {
  /** 11点前出仓 且 24h 达标 —— 正常 */
  exitMetSignMet: number
  /** 11点前出仓 但 24h 未达标 —— 货给到了没派完，司机侧问题 */
  exitMetSignUnmet: number
  /** 未按时出仓 但 24h 达标 —— 司机赶回来了 */
  exitUnmetSignMet: number
  /** 双未达标 —— 仓库晚出仓拖垮派签，连锁失败 */
  exitUnmetSignUnmet: number
}

export type DispatchMetrics = {
  total: number
  before11Met: number
  signMet: number
  /** 百分比 0~100，两位小数；total=0 时为 null（无数据不是 0%） */
  before11Rate: number | null
  /** 派签率；**派签尚未结算时为 null**，要显示「结算中」而不是 0% */
  signRate: number | null
  /** 出仓率 - 派签率 */
  rateGap: number | null
  /**
   * 异常报备剔除数：从 signRate 分母里扣掉了多少单（不影响 before11Rate）。见 DispatchPerformanceException。
   * nextDaySignRate / priorityNextDaySignRate 各自有独立的剔除数（excludedNextDayCount /
   * excludedPriorityCount），三者判定口径不同（24H 滚动窗口 vs 次日固定截止），不能共用同一个数。
   */
  excludedCount: number
  /** 从 nextDaySignRate 分母里扣掉了多少单，跟 excludedCount 可能不一样 */
  excludedNextDayCount: number
  /** 从 priorityNextDaySignRate 分母里扣掉了多少单 */
  excludedPriorityCount: number
  /**
   * 派签是否已结算。两个指标结算时机差一天：出仓在到件日 D+1、派签在 D+2，
   * 所以最新一天只有出仓率，派签率要等次日的定时任务补上。
   */
  dispatchSettled: boolean
  /** 当天出仓（到件日 D 23:59:59 前）达标数与率 */
  sameDayExitMet: number
  sameDayExitRate: number | null
  /** 次日派签（出仓日 23:59:59 前完成）达标数与率；派签未结算时率为 null */
  nextDaySignMet: number
  nextDaySignRate: number | null
  /** 优先件数与其次日完成率；派签未结算或无优先件时率为 null */
  priorityTotal: number
  priorityNextDaySignMet: number
  priorityNextDaySignRate: number | null
  /**
   * 「出仓准点 × 次日派签」交叉格。未达成靠它拆成两段（减法见 attributionBreakdown.ts）：
   * 出仓准点却没派掉 → 司机/负载侧；出仓就晚了 → 分拣出仓侧。
   */
  exitMetNextDaySignMet: number
  /** 优先件的出仓达标数与交叉格，口径同上但分母是 priorityTotal */
  priorityBefore11Met: number
  priorityExitMetNextDaySignMet: number
  problemCount: number
  neverSignedCount: number
  lateSignedCount: number
  /**
   * 供应商利润 Σ(包裹价格 - 派送员价格) / 司机利润 Σ派送员价格。
   * 只统计**签收成功**的包裹，单价按运单的 postcode + suburb 查「区域包裹价格配置」。
   * 与 signRate 不同：金额恒为数值，给的是**截至已结算日**累计的钱（未结算日金额本就是 0）。
   * 区间是否完整看 dispatchSettled —— 为 false 时金额只是「到目前为止」，前端要标出来。
   */
  vendorProfit: number
  courierProfit: number
  /** 签收且匹配到价格的件数 */
  pricedSignedCount: number
  /** 签收但没匹配到区域价格的件数：这些单没计钱，页面要标出来 */
  unpricedSignedCount: number
  quadrant: DispatchQuadrant
}

export type DispatchDriverNode = DispatchMetrics & {
  courierCode: string
  courierName: string
  neverSignedWaybillNos: string[]
  lateSignedWaybillNos: string[]
  problemWaybillNos: string[]
  before11UnmetWaybillNos: string[]
}

/**
 * 统计口径：白名单格子算不算进来。全局一个开关，每一层每一个指标都跟着它走 ——
 * 不存在「率剔白名单但钱不剔」这种逐指标特例。
 */
export type WhitelistMode = 'exclude' | 'include'

export type DispatchRouteNode = DispatchMetrics & {
  routeCode: string
  /**
   * 本行 total 里有多少单落在白名单上。只是标记，不改变本行任何数字。
   * 'exclude' 口径下这些行不在结果里，故恒为 0；'include' 口径下 > 0 表示这条路由本不参与考核。
   */
  whitelistTotal: number
  drivers: DispatchDriverNode[]
  /**
   * 该路由在当前供应商推送配置里实际归属的另一家供应商展示名；有值说明这条路由不在
   * 本供应商自己的配置名单里，是靠实际承运商兜底计入的（例如临时借调别家司机跑了这条路由）。
   * 按当前配置实时算，配置改了这个标记当天就会消失，不是历史快照。
   */
  foreignVendorName?: string
}

export type DispatchSupplierNode = DispatchMetrics & {
  supplierKey: string
  supplierName: string
  vendorCode: string
  routes: DispatchRouteNode[]
}

export type DispatchPerformanceSupplierOption = {
  supplierKey: string
  supplierName: string
  vendorCode: string
}

/**
 * 派签异常报备：司机事故/车坏等不可抗力，某天某供应商×路由码×司机下这些运单号确实送不了。
 * 报备时刻通常早于结算，effectiveCount 可能小于 reportedCount（还没结算/结算后有的单其实已签收）。
 */
export type DispatchPerformanceException = {
  id: string
  stationCode: string
  arrivalDate: string
  supplierKey: string
  routeCode: string
  courierCode: string
  waybillNos: string[]
  reason: string
  reportedBy: string | null
  reportedByName: string
  createdAt: string
  /** 报备的运单号数 */
  reportedCount: number
  /** 与该格子当前的未签收运单号求交集后，真正生效的剔除数 */
  effectiveCount: number
  /** 该格子的派签是否已结算；未结算时 effectiveCount 恒为 0，代表「等结算后生效」而非「无效」 */
  settled: boolean
}

export type DispatchPerformanceExceptionDraft = {
  arrivalDate: string
  supplierKey: string
  routeCode: string
  courierCode: string
  waybillNos: string[]
  reason: string
}

/** 某到件日两趟结算各自跑过没，供详情页展示结算进度 */
export type DispatchSettledBatch = {
  arrivalDate: string
  exitSettled: boolean
  dispatchSettled: boolean
  /** 50h 补跑期已过仍未盖章——不会再自动完成，"结算中"会一直卡住，需要人工处理 */
  dispatchOverdue: boolean
  waybillCount: number
}

// ── 站点配置（列表页）──────────────────────────────────────────────

/** 该站点最近一个有数据的到件日及其汇总，让列表页本身就是多站点看板 */
export type DispatchPerformanceLatest = {
  arrivalDate: string
  metrics: DispatchMetrics
}

export type DispatchPerformanceConfig = {
  id: string
  stationCode: string
  stationName: string
  regionCode: string
  isEnabled: boolean
  createdAt: string
  updatedAt: string
  /** 纳入统计的供应商 = 供应商推送配置的行 id，与四个告警同一套 */
  pushConfigIds: string[]
  /** 每天几点触发结算，HH:mm，按该站点所属州的本地时间 */
  settleTime: string
  /** 「这天算不算开仓分拣」的到件量阈值覆盖；null = 沿用全局默认（2000） */
  minSortingWaybills: number | null
  /** 上面这些配置归并出的供应商单位数；为 0 时结算跑不出数据，列表要提示 */
  supplierCount: number
  /** 最近一个有数据的到件日（出仓率看它）。派签在这天多半还没结算 */
  latest: DispatchPerformanceLatest | null
  /**
   * 最近一个**派签已结算**的到件日，比 latest 早一天左右。
   * 派签率必须读它：最新那天的派签必然还没结算，读 latest 会永远显示「结算中」。
   */
  latestDispatch: DispatchPerformanceLatest | null
}

export type DispatchPerformanceConfigDraft = {
  stationCode: string
  stationName: string
  pushConfigIds: string[]
  /** 触发统计时间 HH:mm，按站点所属州的本地时间 */
  settleTime: string
  /** null = 沿用全局默认（2000） */
  minSortingWaybills: number | null
  isEnabled: boolean
}

// ── 单站点数据（详情页）────────────────────────────────────────────

export type DispatchPerformanceResult = {
  config: {
    id: string
    stationCode: string
    stationName: string
    isEnabled: boolean
  }
  stationCode: string
  startDate: string
  endDate: string
  /** 区间内实际有数据的到件日 */
  arrivalDates: string[]
  /** 日历上出仓趟已该跑完、台账里却没有跑过记录的到件日 = 结算任务真的漏跑的天（服务端已算好） */
  missingDates: string[]
  overall: DispatchMetrics
  /** 'exclude' 口径 = 被剔掉了多少单；'include' 口径 = overall 里含了多少单白名单 */
  whitelistTotal: number
  suppliers: DispatchSupplierNode[]
  /** 该区间内有数据的供应商，供筛选器用 */
  supplierOptions: DispatchPerformanceSupplierOption[]
  /** 最近几批结算进度 */
  recentBatches: DispatchSettledBatch[]
}

// 司机利润趋势相关类型（DispatchProfitDailyRow / DriverProfitSummary / ProfitTrendGranularity 等）
// 及聚合函数 computeDriverProfitTrend 都在 shared/dispatchPerformance/profitTrendAggregate.ts——
// 前后端共用同一份定义和实现，天/周/月切换、按司机全局合并直接在前端本地重算，不用重新请求。
export * from '../../../shared/dispatchPerformance/profitTrendAggregate'

/** 「立刻统计」作业的结果：两趟都已落库，派签是临时值（到点的定时结算会覆盖） */
export type SettleNowArtifact = {
  stationCode: string
  settledExitDates: { arrivalDate: string; waybillCount: number; cellCount: number }[]
  /** 已落库并显示「已结算」，但是临时值：到了该站点的触发统计时间会重跑并覆盖成权威值 */
  settledDispatchDates: {
    arrivalDate: string
    waybillCount: number
    cellCount: number
    total: number
    before11Met: number
    signMet: number
    problemCount: number
  }[]
  skipped: { stage: 'exit' | 'dispatch'; arrivalDate: string }[]
  message: string
  /** 派签落的是权威值（上传运单表结算），不标「临时值」 */
  dispatchFinal?: boolean
}
