import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import type { VendorPushEntry, VendorPushEntryDraft, VendorPushOption } from '../../components/VendorPushPanel/vendorPushTypes'
import { fetchVendors } from '../VendorAnalysis/vendorAnalysisApi'
import type { ExitAlarmSchedule, ExitAlarmScheduleDraft } from './exitAlarmTypes'
import {
  loadExitAlarmVendorConfigs,
  createExitAlarmVendorConfig,
  updateExitAlarmVendorConfig,
  deleteExitAlarmVendorConfig,
  loadExitAlarmSchedule,
  saveExitAlarmSchedule,
} from './exitAlarmApi'

export function useExitAlarmPage() {
  const { imileToken } = useAppSettings()
  const { selectedStations } = useGlobalFilterStore()

  const [vendors, setVendors] = useState<VendorPushOption[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(false)

  const [configs, setConfigs] = useState<VendorPushEntry[]>([])
  const [configsLoading, setConfigsLoading] = useState(false)

  const [schedule, setSchedule] = useState<ExitAlarmSchedule | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)

  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    setVendorsLoading(true)
    void fetchVendors(imileToken).then((res) => {
      setVendorsLoading(false)
      if (res.ok) {
        setVendors(res.data.map((v) => ({ vendorCode: v.vendorCode, vendorNameEn: v.vendorNameEn })))
      } else {
        showToast(`供应商加载失败: ${res.error}`, 'error')
      }
    })

    setConfigsLoading(true)
    void loadExitAlarmVendorConfigs().then((res) => {
      setConfigsLoading(false)
      if (res.ok) setConfigs(res.data)
      else showToast(`推送配置加载失败: ${res.error}`, 'error')
    })

    setScheduleLoading(true)
    void loadExitAlarmSchedule().then((res) => {
      setScheduleLoading(false)
      if (res.ok) setSchedule(res.data)
      else showToast(`定时配置加载失败: ${res.error}`, 'error')
    })
  }, [imileToken])

  const addConfig = useCallback(async (draft: VendorPushEntryDraft): Promise<boolean> => {
    const res = await createExitAlarmVendorConfig(draft)
    if (res.ok) {
      setConfigs((prev) => [...prev, res.data])
      showToast('推送配置已添加', 'success')
      return true
    }
    showToast(`添加失败: ${res.error}`, 'error')
    return false
  }, [])

  const editConfig = useCallback(async (id: string, draft: VendorPushEntryDraft): Promise<boolean> => {
    const res = await updateExitAlarmVendorConfig(id, draft)
    if (res.ok) {
      setConfigs((prev) => prev.map((c) => (c.id === id ? res.data : c)))
      showToast('推送配置已更新', 'success')
      return true
    }
    showToast(`更新失败: ${res.error}`, 'error')
    return false
  }, [])

  const deleteConfig = useCallback(async (id: string): Promise<void> => {
    const res = await deleteExitAlarmVendorConfig(id)
    if (res.ok) {
      setConfigs((prev) => prev.filter((c) => c.id !== id))
      showToast('推送配置已删除', 'success')
    } else {
      showToast(`删除失败: ${res.error}`, 'error')
    }
  }, [])

  const toggleConfigDisabled = useCallback(
    async (id: string, nextDisabled: boolean): Promise<void> => {
      const config = configs.find((c) => c.id === id)
      if (!config) return
      const draft: VendorPushEntryDraft = {
        vendorCode: config.vendorCode,
        vendorName: config.vendorName,
        routeCode: config.routeCode,
        webhookUrl: config.webhookUrl,
        signingSecret: config.signingSecret,
        pushDescription: config.pushDescription,
        isDisabled: nextDisabled,
      }
      const res = await updateExitAlarmVendorConfig(id, draft)
      if (res.ok) {
        setConfigs((prev) => prev.map((c) => (c.id === id ? res.data : c)))
      } else {
        showToast(`操作失败: ${res.error}`, 'error')
      }
    },
    [configs],
  )

  const saveSchedule = useCallback(async (draft: ExitAlarmScheduleDraft): Promise<boolean> => {
    if (!imileToken.trim()) {
      showToast('请先在全局设置中配置 iMile token，再保存定时推送', 'error')
      return false
    }
    setScheduleSaving(true)
    const res = await saveExitAlarmSchedule(draft, imileToken)
    setScheduleSaving(false)
    if (res.ok) {
      setSchedule(res.data)
      showToast('定时推送配置已保存', 'success')
      return true
    }
    showToast(`保存失败: ${res.error}`, 'error')
    return false
  }, [imileToken])

  return {
    vendors,
    vendorsLoading,
    configs,
    configsLoading,
    schedule,
    scheduleLoading,
    scheduleSaving,
    selectedStations,
    addConfig,
    editConfig,
    deleteConfig,
    toggleConfigDisabled,
    saveSchedule,
  }
}
