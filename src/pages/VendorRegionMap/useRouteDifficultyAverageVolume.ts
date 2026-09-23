import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { fetchVendorVolumeTrend } from './vendorRegionMapApi'
import { computeTrendView } from './vendorRegionMapTypes'

/**
 * 当天到件为 0 或低于 300 票的日子不算「正常出勤」，剔除后再摊平均——
 * 直接复用「货量趋势」Tab 已有的按天拉取 + 剔除逻辑（computeTrendView），
 * 只是把脏数据阈值从默认的 1 换成业务认定的 300。
 */
const AVG_VOLUME_DIRTY_THRESHOLD = 300

export type RouteDifficultyAverageVolume = {
  /** 剔除空/低于 300 票的日子后，剩下参与摊平均的自然日数 */
  validDays: number
  /** supplierKey -> 平均单量 */
  supplierAvg: Map<string, number>
  /** `${supplierKey}\0${routeCode}` -> 平均单量 */
  routeAvg: Map<string, number>
}

/** 路由难度的「平均单量」需要按天数据，而区域地图主查询是整段一次性拉取——这里按同一日期区间单独再拉一次按天数据 */
export function useRouteDifficultyAverageVolume(startDate: string | null, endDate: string | null) {
  const { imileToken } = useAppSettings()
  const [data, setData] = useState<RouteDifficultyAverageVolume | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const cancelledRef = useRef(false)

  const load = useCallback(async () => {
    const token = imileToken.trim()
    if (!startDate || !endDate || !token) return
    cancelledRef.current = false
    setLoading(true)
    setError('')
    try {
      const raw = await fetchVendorVolumeTrend({ imileToken: token, startDate, endDate })
      if (cancelledRef.current) return
      const view = computeTrendView({ raw, dirtyThreshold: AVG_VOLUME_DIRTY_THRESHOLD, granularity: 'day' })
      const supplierAvg = new Map(view.suppliers.map((supplier) => [supplier.supplierKey, supplier.dailyAvg]))

      const routeTotals = new Map<string, number>()
      for (const point of view.routeDaily) {
        const key = `${point.supplierKey}\0${point.routeCode}`
        routeTotals.set(key, (routeTotals.get(key) ?? 0) + point.count)
      }
      const routeAvg = new Map<string, number>()
      for (const [key, total] of routeTotals) {
        routeAvg.set(key, view.dates.length > 0 ? total / view.dates.length : 0)
      }

      setData({ validDays: view.dates.length, supplierAvg, routeAvg })
    } catch (err) {
      if (cancelledRef.current) return
      setError(err instanceof Error ? err.message : '平均单量计算失败')
      setData(null)
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [startDate, endDate, imileToken])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    return () => {
      cancelledRef.current = true
    }
  }, [load])

  return { data, loading, error }
}
