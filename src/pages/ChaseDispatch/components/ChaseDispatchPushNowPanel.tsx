import { Button, Checkbox } from 'antd'
import { Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppSettings } from '../../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../../stores/globalFilterStore'
import type { SupplierPushConfig } from '../../../shared/supplierPushConfig/types'
import { showToast } from '../../../utils/toast'
import { triggerChaseDispatchPushNow } from '../chaseDispatchApi'
import { STAGNATION_BUCKET_OPTIONS, type StagnationBucket } from '../chaseDispatchTypes'

type Props = {
  disabled?: boolean
  /** 已在「供应商配置」启用的可推送供应商列表 */
  configs: SupplierPushConfig[]
  /** 定时配置里已选的滞留时间，作为立即推送的默认勾选 */
  defaultBuckets: StagnationBucket[]
}

export function ChaseDispatchPushNowPanel({ disabled, configs, defaultBuckets }: Props) {
  const { imileToken } = useAppSettings()
  const { selectedStations } = useGlobalFilterStore()
  const [buckets, setBuckets] = useState<StagnationBucket[]>(defaultBuckets)
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  useEffect(() => {
    setBuckets(defaultBuckets)
  }, [defaultBuckets])

  const stationCode = selectedStations[0] ?? ''
  const pushDisabled = disabled || loading || configs.length === 0

  const handlePush = async () => {
    if (!stationCode) {
      showToast('请先在顶部选择责任站点', 'error')
      return
    }
    if (buckets.length === 0) {
      showToast('请至少选择一个滞留时间', 'error')
      return
    }
    if (configs.length === 0) {
      showToast('请先在下方「供应商配置」启用要推送的供应商', 'error')
      return
    }
    setLoading(true)
    setLastResult(null)
    try {
      const res = await triggerChaseDispatchPushNow(imileToken, {
        stationCode,
        stagnationBuckets: buckets,
        configIds: configs.map((c) => c.id),
      })
      if (res.ok) {
        const { pushedCount, totalConfigs, errors } = res.data
        const msg = `成功推送 ${pushedCount}/${totalConfigs} 条`
        setLastResult(errors.length > 0 ? `${msg}，失败：${errors.join('；')}` : msg)
        showToast(msg, pushedCount > 0 ? 'success' : 'warning')
      } else {
        setLastResult(`推送失败：${res.error}`)
        showToast(`推送失败: ${res.error}`, 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-section-title px-4 pt-3 pb-0">立即推送</div>
      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        <div>
          <div className="mb-1 text-xs text-slate-500">滞留时间</div>
          <Checkbox.Group
            value={buckets}
            disabled={disabled || loading}
            onChange={(vals) => setBuckets(vals as StagnationBucket[])}
          >
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {STAGNATION_BUCKET_OPTIONS.map((b) => (
                <Checkbox key={b.value} value={b.value}>
                  <span className="text-sm">{b.label}</span>
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>
        </div>
        <Button
          type="primary"
          icon={<Send className="h-3.5 w-3.5" />}
          loading={loading}
          disabled={pushDisabled}
          onClick={() => void handlePush()}
        >
          立即推送催派
        </Button>
      </div>
      <div className="px-4 pb-3 text-xs text-slate-400">
        {stationCode
          ? configs.length > 0
            ? `站点：${stationCode} · 将向已启用的 ${configs.length} 家供应商推送催派飞书卡片`
            : `站点：${stationCode} · 请先在下方「供应商配置」启用要推送的供应商`
          : '请先在顶部 Header 选择责任站点'}
        {lastResult && <span className="ml-3 text-slate-600">{lastResult}</span>}
      </div>
    </div>
  )
}
