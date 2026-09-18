import { useCallback, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppSettings } from '../../context/AppSettingsContext'
import { i18n } from '../../i18n'
import { showToast } from '../../utils/toast'
import { vrmT } from './vendorRegionMapI18n'
import { fetchVendorRegionMap } from './vendorRegionMapApi'
import { buildVendorColorMap } from './vendorColors'
import { type MapMetric, type VendorRegionMapResult } from './vendorRegionMapTypes'

export function useVendorRegionMapPage() {
  const { imileToken } = useAppSettings()
  // 默认当天，进页面不自动拉取，等用户点「查询」
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().startOf('day'),
    dayjs().endOf('day'),
  ])
  const [data, setData] = useState<VendorRegionMapResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedSupplierKeys, setSelectedSupplierKeys] = useState<string[]>([])
  const [metric, setMetric] = useState<MapMetric>('count')

  const query = useCallback(async () => {
    const token = imileToken.trim()
    if (!token) {
      const msg = String(i18n.t('imileTokenRequired', { ns: 'common' }))
      setError(msg)
      showToast(msg, 'warning')
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
        showToast(vrmT('trend.noVendorsMatched'), 'warning')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : vrmT('trend.queryFailed')
      setError(message)
      setData(null)
      showToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [dateRange, imileToken])

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
    metric,
    setMetric,
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
