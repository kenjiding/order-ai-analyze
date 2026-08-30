import { useCallback, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { fetchVendorVolumeTrend } from './vendorRegionMapApi'
import { buildVendorColorMap } from './vendorColors'
import {
  TREND_DEFAULT_SELECTED_COUNT,
  UNMATCHED_SUPPLIER_KEY,
  type VendorVolumeTrendResult,
} from './vendorRegionMapTypes'

export function useVendorVolumeTrend() {
  const { imileToken } = useAppSettings()
  // 默认近 14 天（含今天）；进 Tab 不自动拉取，等用户点「查询」
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(13, 'day').startOf('day'),
    dayjs().endOf('day'),
  ])
  const [data, setData] = useState<VendorVolumeTrendResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedSupplierKeys, setSelectedSupplierKeys] = useState<string[]>([])
  const [routeSupplierKey, setRouteSupplierKey] = useState('')

  const query = useCallback(async () => {
    const token = imileToken.trim()
    if (!token) {
      setError('请先在全局设置中配置 iMile Token')
      showToast('请先在全局设置中配置 iMile Token', 'warning')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await fetchVendorVolumeTrend({
        imileToken: token,
        startDate: dateRange[0].format('YYYY-MM-DD'),
        endDate: dateRange[1].format('YYYY-MM-DD'),
      })
      setData(result)
      // 十几条线一起画会糊成一团：默认只亮票量前几家，未匹配的那条不默认参与
      const defaults = result.suppliers
        .filter((supplier) => supplier.supplierKey !== UNMATCHED_SUPPLIER_KEY)
        .slice(0, TREND_DEFAULT_SELECTED_COUNT)
        .map((supplier) => supplier.supplierKey)
      setSelectedSupplierKeys(defaults)
      setRouteSupplierKey(defaults[0] ?? result.suppliers[0]?.supplierKey ?? '')
      if (result.meta.failedDates.length > 0) {
        showToast(`有 ${result.meta.failedDates.length} 天到件数据拉取失败，已从统计中剔除`, 'warning')
      } else if (result.suppliers.length === 0) {
        showToast('已拉取扫描数据，但没有匹配到任何供应商', 'warning')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '查询失败'
      setError(message)
      setData(null)
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [dateRange, imileToken])

  const allSupplierKeys = useMemo(
    () => (data?.suppliers ?? []).map((supplier) => supplier.supplierKey),
    [data],
  )

  // 与地图 Tab 用同一个函数上色，同一家供应商在两个 Tab 里颜色一致
  const vendorColorMap = useMemo(() => buildVendorColorMap(allSupplierKeys), [allSupplierKeys])

  const toggleSupplier = useCallback(
    (supplierKey: string, nextChecked: boolean) => {
      setSelectedSupplierKeys((current) => {
        const selected = new Set(current)
        if (nextChecked) selected.add(supplierKey)
        else selected.delete(supplierKey)
        return allSupplierKeys.filter((key) => selected.has(key))
      })
    },
    [allSupplierKeys],
  )

  const selectAllSuppliers = useCallback(() => {
    setSelectedSupplierKeys(allSupplierKeys)
  }, [allSupplierKeys])

  const clearSuppliers = useCallback(() => {
    setSelectedSupplierKeys([])
  }, [])

  return {
    dateRange,
    setDateRange,
    data,
    loading,
    error,
    selectedSupplierKeys,
    toggleSupplier,
    selectAllSuppliers,
    clearSuppliers,
    routeSupplierKey,
    setRouteSupplierKey,
    query,
    vendorColorMap,
  }
}
