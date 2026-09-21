import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import { fetchDispatchPerformanceData } from './dispatchPerformanceApi'
import type { DispatchPerformanceResult, WhitelistMode } from './dispatchPerformanceTypes'
import { useSettleNow } from './useSettleNow'

/** 默认区间：最近 7 天。结算最长滞后 4 天（周五到件→下周二），7 天能稳定看到几批完整数据 */
const DEFAULT_RANGE_DAYS = 7

/**
 * 单站点详情页：日期范围与供应商筛选都只影响展示，不触发统计——数据由每日到点的
 * 定时任务分两趟产出。唯一的例外是「立刻统计」：入队一个手动结算作业，出仓落库、
 * 派签只试算（原因见后端 dispatchPerformanceSettleHandler 的文件头）。
 */
export function useDispatchPerformanceDetailPage(configId: string | undefined) {
  const { t } = useTranslation('dispatchPerformance')
  const queryError = t('toast.queryError')

  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs().subtract(DEFAULT_RANGE_DAYS, 'day'),
    dayjs().subtract(1, 'day'),
  ])
  const [supplierKeys, setSupplierKeys] = useState<string[]>([])
  const [whitelistMode, setWhitelistMode] = useState<WhitelistMode>('include')
  const [result, setResult] = useState<DispatchPerformanceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 只保留最后一次请求的结果：快速改日期时，先发的慢响应不能覆盖后发的
  const abortRef = useRef<AbortController | null>(null)

  const startDate = range[0].format('YYYY-MM-DD')
  const endDate = range[1].format('YYYY-MM-DD')

  const load = useCallback(async () => {
    if (!configId) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDispatchPerformanceData(
        { configId, startDate, endDate, supplierKeys, whitelistMode },
        controller.signal,
      )
      if (!controller.signal.aborted) setResult(data)
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
      setError(err instanceof Error ? err.message : queryError)
      setResult(null)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [configId, startDate, endDate, supplierKeys, whitelistMode, queryError])

  useEffect(() => {
    // 筛选条件变化即重查已存的统计结果（不拉 iMile）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => () => abortRef.current?.abort(), [])

  /** 区间内派签尚未结算（最新那天通常如此），用于提示「派签率还在结算中」 */
  const pendingDispatch = useMemo(
    () => result != null && result.overall.total > 0 && !result.overall.dispatchSettled,
    [result],
  )

  // 触发与轮询由共用 hook 承担；结算完刷新展示数据（出仓趟可能刚落库）
  const settle = useSettleNow({ onSettled: load })

  return {
    range,
    setRange,
    supplierKeys,
    setSupplierKeys,
    whitelistMode,
    setWhitelistMode,
    result,
    // 服务端按结算台账算好的「真的漏跑」的天，不能在前端拿 arrivalDates 反推：
    // 周末没批次、不分拣的工作日 0 格子、供应商筛选，都会让有跑过的天看起来是空的
    missingDates: result?.missingDates ?? [],
    pendingDispatch,
    loading,
    error,
    reload: load,
    settling: settle.settling,
    settleResult: settle.artifact,
    settleNow: useCallback(() => configId && settle.settleNow(configId), [configId, settle]),
    dismissSettleResult: settle.dismissArtifact,
  }
}
