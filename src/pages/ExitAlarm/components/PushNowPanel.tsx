import { Button, DatePicker } from 'antd'
import { Download, Send } from 'lucide-react'
import dayjs from 'dayjs'
import { useState } from 'react'
import { useAppSettings } from '../../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../../stores/globalFilterStore'
import type { SupplierPushConfig } from '../../../shared/supplierPushConfig/types'
import { showToast } from '../../../utils/toast'
import { triggerExitAlarmPushNow } from '../exitAlarmApi'
import type { ExitAlarmExportSheet } from '../exitAlarmTypes'
import { exportExitAlarmXlsx } from '../exportExitAlarmXlsx'

type Props = {
  disabled?: boolean
  /** 已在「供应商配置」启用的可推送供应商列表 */
  configs: SupplierPushConfig[]
}

type ExportPayload = {
  stationCode: string
  date: string
  sheets: ExitAlarmExportSheet[]
}

export function PushNowPanel({ disabled, configs }: Props) {
  const { imileToken } = useAppSettings()
  const { selectedStations } = useGlobalFilterStore()
  const [date, setDate] = useState<dayjs.Dayjs | null>(dayjs().subtract(1, 'day'))
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [exportPayload, setExportPayload] = useState<ExportPayload | null>(null)

  const stationCode = selectedStations[0] ?? ''
  const pushDisabled = disabled || loading || configs.length === 0

  const handlePush = async () => {
    if (!stationCode) {
      showToast('请先在顶部选择责任站点', 'error')
      return
    }
    if (!date) {
      showToast('请选择数据日期', 'error')
      return
    }
    if (configs.length === 0) {
      showToast('请先在下方「供应商配置」启用要推送的供应商', 'error')
      return
    }
    setLoading(true)
    setLastResult(null)
    setExportPayload(null)
    try {
      const res = await triggerExitAlarmPushNow(imileToken, {
        stationCode,
        date: date.format('YYYY-MM-DD'),
        configIds: configs.map((c) => c.id),
      })
      if (res.ok) {
        const { pushedCount, totalConfigs, errors, exportSheets } = res.data
        const msg = `成功推送 ${pushedCount}/${totalConfigs} 条`
        setLastResult(errors.length > 0 ? `${msg}，失败：${errors.join('；')}` : msg)
        showToast(msg, pushedCount > 0 ? 'success' : 'warning')
        if (Array.isArray(exportSheets) && exportSheets.length > 0) {
          setExportPayload({
            stationCode: res.data.stationCode || stationCode,
            date: res.data.date || date.format('YYYY-MM-DD'),
            sheets: exportSheets,
          })
        }
      } else {
        setLastResult(`推送失败：${res.error}`)
        showToast(`推送失败: ${res.error}`, 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    if (!exportPayload) return
    try {
      exportExitAlarmXlsx(exportPayload)
      showToast('导出成功', 'success')
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      showToast(`导出失败: ${reason}`, 'error')
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-section-title px-4 pt-3 pb-0">立即推送</div>
      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        <div>
          <div className="mb-1 text-xs text-slate-500">数据日期（按当前账号州/区域判断）</div>
          <DatePicker
            value={date}
            onChange={(d) => {
              setDate(d)
              setExportPayload(null)
            }}
            placeholder="选择日期"
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            disabled={disabled || loading}
          />
        </div>
        <Button
          type="primary"
          icon={<Send className="h-3.5 w-3.5" />}
          loading={loading}
          disabled={pushDisabled}
          onClick={() => void handlePush()}
        >
          立即检查并推送
        </Button>
        {exportPayload && (
          <Button
            icon={<Download className="h-3.5 w-3.5" />}
            disabled={disabled || loading}
            onClick={handleExport}
          >
            导出数据
          </Button>
        )}
      </div>
      <div className="px-4 pb-3 text-xs text-slate-400">
        {stationCode
          ? configs.length > 0
            ? `站点：${stationCode} · 将向已启用的 ${configs.length} 家供应商推送出仓告警飞书卡片`
            : `站点：${stationCode} · 请先在下方「供应商配置」启用要推送的供应商`
          : '请先在顶部 Header 选择责任站点'}
        {lastResult && <span className="ml-3 text-slate-600">{lastResult}</span>}
      </div>
    </div>
  )
}
