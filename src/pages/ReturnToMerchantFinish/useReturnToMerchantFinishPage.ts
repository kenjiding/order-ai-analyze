import { useCallback, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { dedupeBagsForSubmit, isBagFinishSuccess } from './bagFinish'
import {
  fetchBagInfoRows,
  submitBagFinish,
  type BagFinishResult,
  type BagInfoRow,
} from './returnToMerchantFinishApi'

const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'
/** 选择器只到日期，起止各自补足当天 00:00:00 / 23:59:59 再发给 iMile */
/** 后端单次提交上限 200，选超了按批提交而不是让整批 400 */
const SUBMIT_CHUNK = 200

export type BagRow = BagInfoRow & { key: string }

export type BagFilters = {
  type?: string
  targetCode?: string
  createDate: Dayjs | null
}

const EMPTY_FILTERS: BagFilters = { type: undefined, targetCode: undefined, createDate: null }

function defaultRange(): [Dayjs, Dayjs] {
  return [dayjs().subtract(14, 'day').startOf('day'), dayjs().endOf('day')]
}

export function useReturnToMerchantFinishPage() {
  const { imileToken } = useAppSettings()
  const stationCode = useGlobalFilterStore((state) => state.selectedStations[0] ?? '')
  const stations = useGlobalFilterStore((state) => state.stations)
  const stationLabel = stations.find((item) => item.value === stationCode)?.label ?? stationCode

  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRange)
  const [filters, setFilters] = useState<BagFilters>(EMPTY_FILTERS)
  const [rows, setRows] = useState<BagRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedAt, setLoadedAt] = useState<string>('')
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [results, setResults] = useState<Record<string, BagFinishResult>>({})
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const load = useCallback(async () => {
    if (!stationCode) {
      showToast('请先在页面顶部选择责任站点', 'error')
      return
    }
    if (!imileToken) {
      showToast('未配置 iMile token，请在「系统设置」中填写', 'error')
      return
    }
    setLoading(true)
    try {
      const data = await fetchBagInfoRows({
        imileToken,
        stationCode,
        startDate: range[0].startOf('day').format(DATE_TIME_FORMAT),
        endDate: range[1].endOf('day').format(DATE_TIME_FORMAT),
      })
      setRows(data.rows.map((row, index) => ({ ...row, key: `${row.bagNumber}__${index}` })))
      setSelectedKeys([])
      setResults({})
      setLoadedAt(dayjs().format('HH:mm:ss'))
      showToast(`已加载 ${data.rows.length} 条集包`, 'success')
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : '集包查询失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [imileToken, range, stationCode])

  const typeOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.type).filter(Boolean))).sort(),
    [rows],
  )
  const targetCodeOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.targetCode).filter(Boolean))).sort(),
    [rows],
  )

  const filteredRows = useMemo(() => {
    const day = filters.createDate?.format('YYYY-MM-DD')
    return rows.filter((row) => {
      if (filters.type && row.type !== filters.type) return false
      if (filters.targetCode && row.targetCode !== filters.targetCode) return false
      if (day && row.createDate.slice(0, 10) !== day) return false
      return true
    })
  }, [filters, rows])

  /** 勾选行按集包号去重后的待提交集合 */
  const selectedBags = useMemo(() => {
    const keySet = new Set(selectedKeys)
    return dedupeBagsForSubmit(rows.filter((row) => keySet.has(row.key)))
  }, [rows, selectedKeys])

  const selectedWaybillCount = useMemo(
    () => selectedBags.reduce((sum, bag) => sum + bag.waybillTotalCount, 0),
    [selectedBags],
  )

  const submit = useCallback(async () => {
    if (!selectedBags.length || submitting) return
    setSubmitting(true)
    setProgress({ done: 0, total: selectedBags.length })
    const collected: Record<string, BagFinishResult> = {}
    try {
      for (let i = 0; i < selectedBags.length; i += SUBMIT_CHUNK) {
        const chunk = selectedBags.slice(i, i + SUBMIT_CHUNK)
        const data = await submitBagFinish({ imileToken, stationCode, bags: chunk })
        for (const result of data.results) collected[result.scanNumber] = result
        setResults((prev) => ({ ...prev, ...collected }))
        setProgress({ done: Math.min(i + chunk.length, selectedBags.length), total: selectedBags.length })
      }
      const succeeded = Object.values(collected).filter(isBagFinishSuccess).length
      const failed = Object.keys(collected).length - succeeded
      if (failed === 0) showToast(`退返商家成功 ${succeeded} 个集包`, 'success')
      else showToast(`完结结束：成功 ${succeeded} 个，失败 ${failed} 个`, 'error')
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : '退返商家完结失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [imileToken, selectedBags, stationCode, submitting])

  return {
    stationCode,
    stationLabel,
    range,
    setRange,
    filters,
    setFilters,
    resetFilters: useCallback(() => setFilters(EMPTY_FILTERS), []),
    rows,
    filteredRows,
    typeOptions,
    targetCodeOptions,
    loading,
    loadedAt,
    load,
    selectedKeys,
    setSelectedKeys,
    selectedBags,
    selectedWaybillCount,
    results,
    submitting,
    progress,
    submit,
  }
}
