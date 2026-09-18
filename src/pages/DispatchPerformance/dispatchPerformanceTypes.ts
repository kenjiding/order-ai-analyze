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

export type DispatchRouteNode = DispatchMetrics & {
  routeCode: string
  /**
   * 本行 total 里有多少单落在白名单上、因而没进供应商行与站点汇总的率。
   * 0 = 全部计入；等于 total = 整条路由都不计入；介于两者之间 = 区间内改过白名单配置。
   */
  whitelistTotal: number
  drivers: DispatchDriverNode[]
}

export type DispatchSupplierNode = DispatchMetrics & {
  supplierKey: string
  supplierName: string
  vendorCode: string
  /** 该供应商名下白名单路由的单量：没算进本行的 total 与两个率，展开后能看到明细 */
  whitelistTotal: number
  routes: DispatchRouteNode[]
}

export type DispatchPerformanceSupplierOption = {
  supplierKey: string
  supplierName: string
  vendorCode: string
}

/** 某到件日两趟结算各自跑过没，供详情页展示结算进度 */
export type DispatchSettledBatch = {
  arrivalDate: string
  exitSettled: boolean
  dispatchSettled: boolean
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
  /** 全站白名单路由的单量：同样没算进 overall */
  whitelistTotal: number
  suppliers: DispatchSupplierNode[]
  /** 该区间内有数据的供应商，供筛选器用 */
  supplierOptions: DispatchPerformanceSupplierOption[]
  /** 最近几批结算进度 */
  recentBatches: DispatchSettledBatch[]
}

/** 「立刻统计」作业的结果：两趟都已落库，派签是临时值（到点的定时结算会覆盖） */
export type SettleNowArtifact = {
  stationCode: string
  settledExitDates: { arrivalDate: string; waybillCount: number; cellCount: number }[]
  /** 已落库，但派签未在台账盖章：到了该站点的触发统计时间会重跑并覆盖成权威值 */
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
}
