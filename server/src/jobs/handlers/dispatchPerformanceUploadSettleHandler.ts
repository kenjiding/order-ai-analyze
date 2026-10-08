/**
 * 「上传运单表结算」：iMile 拦截 searchWaybill（网关 429）时的手动补数通道。
 *
 * 上传入口（dispatchPerformanceRouter 的 upload-settle）已在 API 进程里做完校验——派签窗口已到期、
 * 未被权威结算过、到件索引 100% 被上传的表覆盖——并把表格明细写进运单缓存。本作业只带
 * (stationCode, arrivalDate)，在 worker 里以 fromUpload 模式走与定时结算完全相同的
 * settleOneArrivalDate：只读缓存，不发 iMile 请求。上万行明细不进作业 payload，
 * 否则前端每 2 秒轮询作业都会把它整份带回去。
 *
 * 落的是**权威值**（非 provisional）：上传入口只放行派签窗口已关闭的到件日，
 * 定时任务也不会再碰这天（台账已盖章）。
 *
 * 结果沿用「立刻统计」的 artifact 结构，前端复用同一个结果弹窗。
 */
import {
  readDispatchPerformanceImileToken,
  resolveStationTargets,
  settleOneArrivalDate,
  withSettleLock,
} from '../../dispatch24hStats/dailyStatsJob'
import type { JobHandler, JobHandlerResult } from '../types'
import { summarizeCells, type DispatchPerformanceSettleArtifact } from './dispatchPerformanceSettleHandler'

export const DISPATCH_PERFORMANCE_UPLOAD_SETTLE_JOB_TYPE = 'dispatch-performance.settle-upload'

export const dispatchPerformanceUploadSettleHandler: JobHandler = {
  type: DISPATCH_PERFORMANCE_UPLOAD_SETTLE_JOB_TYPE,

  async run({ job }): Promise<JobHandlerResult> {
    const payload = (job.payload ?? {}) as { stationCode?: unknown; arrivalDate?: unknown }
    const stationCode = String(payload.stationCode ?? '').trim()
    const arrivalDate = String(payload.arrivalDate ?? '').trim()
    if (!stationCode || !arrivalDate) throw new Error('缺少 stationCode 或 arrivalDate')

    const target = (await resolveStationTargets()).find((t) => t.stationCode === stationCode)
    if (!target) {
      throw new Error(`站点 ${stationCode} 未启用统计，或该站点下没有配置任何供应商`)
    }

    // 到件索引已由上传入口写进缓存；token 只在缓存意外被清掉时兜底重拉索引用
    const token = await readDispatchPerformanceImileToken(job.createdBy)
    const result = await withSettleLock(() =>
      settleOneArrivalDate({ token, target, arrivalDate, stage: 'dispatch', fromUpload: true }),
    )

    const artifact: DispatchPerformanceSettleArtifact = {
      stationCode,
      settledExitDates: [],
      settledDispatchDates: result.skipped || result.noBatch
        ? []
        : [
            {
              arrivalDate,
              waybillCount: result.waybillCount,
              cellCount: result.cellCount,
              ...summarizeCells(result.cells),
            },
          ],
      skipped: [],
      message: result.skipped
        ? `${arrivalDate} 已被结算过，本次未写入`
        : result.noBatch
          ? `${arrivalDate} 到件仅 ${result.waybillCount} 单，判定当天未开仓分拣，未写入统计`
          : '',
      dispatchFinal: true,
    }
    return { artifactPayload: artifact }
  },
}
