import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDispatchProfitTrend } from './dispatchPerformanceApi'
import {
  computeProfitTrend,
  type DispatchProfitDailyRow,
  type ProfitDimension,
  type ProfitTrendGranularity,
  type WhitelistMode,
} from './dispatchPerformanceTypes'

/**
 * 利润稳定性：日期范围/白名单口径跟详情页共用（不重复维护），但供应商筛选是本模块自己的一份——
 * 「哪个维度更赚钱、稳不稳」常常需要单独锁定一家供应商看，不希望跟着页面顶部的筛选联动变化。
 * 服务端只吐 (到件日, 供应商, 路由码, 司机) 最细粒度不合桶的原始行，供应商/路由码/司机三个维度
 * 切换、天/周/月切换都在本地重算，不重新请求。
 */
export function useProfitStabilityTrend(params: {
  configId: string | undefined
  startDate: string
  endDate: string
  whitelistMode: WhitelistMode
}) {
  const { configId, startDate, endDate, whitelistMode } = params
  const [supplierKeys, setSupplierKeys] = useState<string[]>([])
  const [rows, setRows] = useState<DispatchProfitDailyRow[]>([])
  const [dimension, setDimension] = useState<ProfitDimension>('courier')
  const [granularity, setGranularity] = useState<ProfitTrendGranularity>('week')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!configId) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDispatchProfitTrend(
        { configId, startDate, endDate, supplierKeys, whitelistMode },
        controller.signal,
      )
      if (!controller.signal.aborted) setRows(data)
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
      setError(err instanceof Error ? err.message : '查询失败')
      setRows([])
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [configId, startDate, endDate, supplierKeys, whitelistMode])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => () => abortRef.current?.abort(), [])

  const result = useMemo(
    () => computeProfitTrend(rows, granularity, dimension),
    [rows, granularity, dimension],
  )

  return {
    result,
    dimension,
    setDimension,
    granularity,
    setGranularity,
    supplierKeys,
    setSupplierKeys,
    loading,
    error,
    reload: load,
  }
}
