/**
 * 「立刻统计」手动结算：两趟都落库，点完就能在页面上看到出仓率和派签率。
 *
 * 走作业队列而不是在 API 进程里直接跑，是因为调度器在 worker 进程，
 * `runDispatchPerformanceDailyStats` 的 isRunning 互斥锁是进程内的——两个进程同时对同一个
 * (station, arrivalDate) 做 delete+insert 会互相打架。入队后由 worker 独占执行，天然串行。
 *
 * **派签落的是临时值，不给台账盖章**（provisional）。定时任务默认定在 16:00（每条站点配置可改），是为了给
 * 「晚于 11 点出仓」的单留足真实的 24h 窗口：某单 O 日 14:00 出仓，真实窗口到 O+1 14:00 才关，
 * 而结算上界是 O+1 11:00——到点跑时窗口早关了、结论准确；11:30 手动跑则会把它记成未达标，
 * 哪怕它 13:00 就签收了。所以手动跑出来的派签值只当即时视图，台账上 dispatch_settled_at 留空，
 * 定时结算到点仍会重跑一次、整体覆盖成权威值。
 *
 * 出仓趟没有这个问题：阈值就是出仓日 11:00，过了就定死，提前跑与到点跑结论一致。
 * 派签趟重算出的出仓数据同样准确，所以它照常给出仓那一趟盖章——否则出仓趟会再跑一次、
 * 用 rule=null 把刚落的派签结果清成 0。
 */
import {
  readDispatchPerformanceImileToken,
  resolveStationTargets,
  settleOneArrivalDate,
  withSettleLock,
} from '../../dispatch24hStats/dailyStatsJob'
import { listSettledArrivalDates } from '../../dispatch24hStats/repository'
import {
  resolveDispatchDueArrivalDates,
  resolveExitDueArrivalDates,
  resolveExitSettledArrivalDates,
  resolveSettledArrivalDates,
} from '../../dispatch24hStats/settledArrivalDates'
import type { DispatchPerformanceCell } from '../../dispatch24hStats/aggregateCells'
import type { JobHandler, JobHandlerResult } from '../types'

export const DISPATCH_PERFORMANCE_SETTLE_JOB_TYPE = 'dispatch-performance.settle-now'

export type DispatchPerformanceSettleArtifact = {
  stationCode: string
  /** 出仓趟已落库的到件日 */
  settledExitDates: { arrivalDate: string; waybillCount: number; cellCount: number }[]
  /** 派签趟已落库的到件日（临时值，到点的定时结算会覆盖） */
  settledDispatchDates: {
    arrivalDate: string
    waybillCount: number
    cellCount: number
    total: number
    before11Met: number
    signMet: number
    problemCount: number
  }[]
  /** 已过期不回补的到件日 */
  skipped: { stage: 'exit' | 'dispatch'; arrivalDate: string }[]
  /** 两趟都没有可处理的批次时，给前端一句能直接展示的原因 */
  message: string
}

function summarizeCells(cells: DispatchPerformanceCell[]): {
  total: number
  before11Met: number
  signMet: number
  problemCount: number
} {
  let total = 0
  let before11Met = 0
  let signMet = 0
  let problemCount = 0
  for (const cell of cells) {
    // 与页面上的供应商/站点口径一致：白名单路由不计入两个率
    if (cell.isWhitelist) continue
    total += cell.total
    before11Met += cell.before11Met
    // 签收达标 = 四象限里签收达标的两格
    signMet += cell.exitMetSignMet + cell.exitUnmetSignMet
    problemCount += cell.problemCount
  }
  return { total, before11Met, signMet, problemCount }
}

/** 某一趟里「已到期未结算」中，哪些刚到期该跑、哪些已过期只能放弃 */
async function splitPending(input: {
  stationCode: string
  nowMs: number
  tz: Parameters<typeof resolveExitDueArrivalDates>[1]
  stage: 'exit' | 'dispatch'
}): Promise<{ toRun: string[]; skipped: string[] }> {
  const { stationCode, nowMs, tz, stage } = input
  // 与定时结算一致：不按星期几筛，开没开仓由到件量判定
  const settled =
    stage === 'dispatch'
      ? resolveSettledArrivalDates(nowMs, tz)
      : resolveExitSettledArrivalDates(nowMs, tz)
  if (settled.length === 0) return { toRun: [], skipped: [] }

  const done = await listSettledArrivalDates(stationCode, settled, stage)
  const pending = settled.filter((date) => !done.has(date))
  const due = new Set(
    stage === 'dispatch'
      ? resolveDispatchDueArrivalDates(nowMs, tz)
      : resolveExitDueArrivalDates(nowMs, tz),
  )
  return {
    toRun: pending.filter((date) => due.has(date)),
    skipped: pending.filter((date) => !due.has(date)),
  }
}

export const dispatchPerformanceSettleHandler: JobHandler = {
  type: DISPATCH_PERFORMANCE_SETTLE_JOB_TYPE,

  async run({ job, signal, reportProgress }): Promise<JobHandlerResult> {
    const payload = (job.payload ?? {}) as { stationCode?: unknown }
    const stationCode = String(payload.stationCode ?? '').trim()
    if (!stationCode) throw new Error('缺少 stationCode')

    // 用发起人的身份取 token：手动统计跟其他页面走同一个「系统设置」里的全局 token，
    // 不会出现「页面能拉、后台报 Invalid access token」的错位
    const token = await readDispatchPerformanceImileToken(job.createdBy)
    if (!token) {
      throw new Error('缺少 iMile token，请先在「系统设置」里配置 iMile Token')
    }

    const target = (await resolveStationTargets()).find((t) => t.stationCode === stationCode)
    if (!target) {
      throw new Error(`站点 ${stationCode} 未启用统计，或该站点下没有配置任何供应商`)
    }

    const nowMs = Date.now()
    const exitSplit = await splitPending({ stationCode, nowMs, tz: target.tz, stage: 'exit' })
    // 派签趟同样只处理「窗口已到期」的批次——窗口没关就算，会把归班盘点重派的单算乱
    const dispatchSplit = await splitPending({
      stationCode,
      nowMs,
      tz: target.tz,
      stage: 'dispatch',
    })

    const artifact: DispatchPerformanceSettleArtifact = {
      stationCode,
      settledExitDates: [],
      settledDispatchDates: [],
      skipped: [
        ...exitSplit.skipped.map((arrivalDate) => ({ stage: 'exit' as const, arrivalDate })),
        ...dispatchSplit.skipped.map((arrivalDate) => ({
          stage: 'dispatch' as const,
          arrivalDate,
        })),
      ],
      message: '',
    }

    const totalSteps = exitSplit.toRun.length + dispatchSplit.toRun.length
    let step = 0
    const bump = async (label: string) => {
      step += 1
      await reportProgress({ step, totalSteps, label })
    }

    for (const arrivalDate of exitSplit.toRun) {
      if (signal.aborted) throw new Error('任务已取消')
      const result = await withSettleLock(() =>
        settleOneArrivalDate({ token, target, arrivalDate, stage: 'exit' }),
      )
      if (!result.skipped) {
        artifact.settledExitDates.push({
          arrivalDate,
          waybillCount: result.waybillCount,
          cellCount: result.cellCount,
        })
      }
      await bump(`出仓已结算 ${arrivalDate}`)
    }

    for (const arrivalDate of dispatchSplit.toRun) {
      if (signal.aborted) throw new Error('任务已取消')
      const result = await withSettleLock(() =>
        settleOneArrivalDate({
          token,
          target,
          arrivalDate,
          stage: 'dispatch',
          // 落库但不给派签盖章，定时结算到点仍会覆盖成权威值
          provisional: true,
        }),
      )
      if (!result.skipped) {
        artifact.settledDispatchDates.push({
          arrivalDate,
          waybillCount: result.waybillCount,
          cellCount: result.cellCount,
          ...summarizeCells(result.cells),
        })
      }
      await bump(`派签已结算 ${arrivalDate}`)
    }

    if (totalSteps === 0) {
      artifact.message =
        artifact.skipped.length > 0
          ? '没有刚到期的批次；已过期的批次不回补（回补会读到退仓重派后的状态）。'
          : '当前没有到期的批次。出仓要等到出仓日 11:00（周五/六/日到件是下周一 11:00），派签再晚一些，此前无可结算数据。'
    }

    return { artifactPayload: artifact }
  },
}
