import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { fetchVendorRegionMap } from './vendorRegionMapApi'
import { buildVendorColorMap } from './vendorColors'
import {
  DEFAULT_RANGE_END,
  DEFAULT_RANGE_START,
  type VendorRegionMapResult,
} from './vendorRegionMapTypes'

export function useVendorRegionMapPage() {
  const { imileToken, settingsLoaded } = useAppSettings()
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs(DEFAULT_RANGE_START),
    dayjs(DEFAULT_RANGE_END),
  ])
  const [data, setData] = useState<VendorRegionMapResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedSupplierKeys, setSelectedSupplierKeys] = useState<string[]>([])

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
      const result = await fetchVendorRegionMap({
        imileToken: token,
        startDate: dateRange[0].format('YYYY-MM-DD'),
        endDate: dateRange[1].format('YYYY-MM-DD'),
      })
      setData(result)
      setSelectedSupplierKeys(result.vendors.map((vendor) => vendor.supplierKey))
      if (result.meta.matchedPackages === 0) {
        showToast('已拉取扫描数据，但没有匹配到供应商路由码的包裹', 'warning')
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

  useEffect(() => {
    if (!settingsLoaded) return
    const timer = window.setTimeout(() => {
      void query()
    }, 0)
    return () => window.clearTimeout(timer)
    // 进入页面按默认 08/24–08/25 自动拉一次；之后改日期需点查询
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded])

  const allSupplierKeys = useMemo(
    () => (data?.vendors ?? []).map((vendor) => vendor.supplierKey),
    [data],
  )

  const vendorColorMap = useMemo(() => buildVendorColorMap(allSupplierKeys), [allSupplierKeys])

  const selectAllVendors = useCallback(() => {
    setSelectedSupplierKeys(allSupplierKeys)
  }, [allSupplierKeys])

  const invertVendorSelection = useCallback(() => {
    setSelectedSupplierKeys((current) => {
      const selected = new Set(current)
      return allSupplierKeys.filter((key) => !selected.has(key))
    })
  }, [allSupplierKeys])

  const toggleVendor = useCallback(
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

  return {
    dateRange,
    setDateRange,
    data,
    loading,
    error,
    selectedSupplierKeys,
    selectAllVendors,
    invertVendorSelection,
    toggleVendor,
    query,
    vendorColorMap,
  }
}
