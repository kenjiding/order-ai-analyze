import { Button } from 'antd'
import { Send } from 'lucide-react'
import { useState } from 'react'
import { useAppSettings } from '../../../context/AppSettingsContext'
import type { SupplierPushConfig } from '../../../shared/supplierPushConfig/types'
import { showToast } from '../../../utils/toast'
import { triggerWorkOrderPushNow } from '../workOrderPushApi'

type Props = {
  disabled?: boolean
  /** 已在「供应商配置」启用的可推送供应商列表 */
  configs: SupplierPushConfig[]
}

export function WorkOrderPushNowPanel({ disabled, configs }: Props) {
  const { imileToken } = useAppSettings()
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const pushDisabled = disabled || loading || configs.length === 0

  const handlePush = async () => {
    if (configs.length === 0) {
      showToast('请先在下方「供应商配置」启用要推送的供应商', 'error')
      return
    }
    setLoading(true)
    setLastResult(null)
    try {
      const res = await triggerWorkOrderPushNow(imileToken, {
        configIds: configs.map((c) => c.id),
      })
      if (res.ok) {
        const { pushedCount, totalConfigs, errors } = res.data
        const msg =
          pushedCount > 0
            ? `成功推送 ${pushedCount}/${totalConfigs} 条`
            : `本次检查中 ${totalConfigs} 家已启用供应商均无未处理工单，无需推送`
        setLastResult(errors.length > 0 ? `${msg}，失败：${errors.join('；')}` : msg)
        showToast(msg, errors.length > 0 ? 'warning' : 'success')
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
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Button
          type="primary"
          icon={<Send className="h-3.5 w-3.5" />}
          loading={loading}
          disabled={pushDisabled}
          onClick={() => void handlePush()}
        >
          立即检查并推送
        </Button>
      </div>
      <div className="px-4 pb-3 text-xs text-slate-400">
        {configs.length > 0
          ? `将检查已启用的 ${configs.length} 家供应商，若有未处理工单则推送飞书卡片，没有则跳过`
          : '请先在下方「供应商配置」启用要推送的供应商'}
        {lastResult && <span className="ml-3 text-slate-600">{lastResult}</span>}
      </div>
    </div>
  )
}
