import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import {
  useSupplierConfigScopeBinding,
  useSupplierPushCatalog,
} from '../../shared/supplierPushConfig'
import type { ExitAlarmSchedule, ExitAlarmScheduleDraft } from './exitAlarmTypes'
import { loadExitAlarmSchedule, saveExitAlarmSchedule } from './exitAlarmApi'

const EXIT_ALARM_SCHEDULED_SCOPE = 'exit-alarm.scheduled' as const

export function useExitAlarmPage() {
  const { imileToken } = useAppSettings()
  const { selectedStations } = useGlobalFilterStore()

  const catalog = useSupplierPushCatalog()
  const scopeBinding = useSupplierConfigScopeBinding(EXIT_ALARM_SCHEDULED_SCOPE, catalog.configs)

  const [schedule, setSchedule] = useState<ExitAlarmSchedule | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)

  // 「编辑」统一驱动定时推送配置与供应商配置（多选）：未加载出配置前默认可编辑，
  // 加载完成后进入只读态，点击「编辑」才能同时修改两者，点击「保存」一并提交。
  const [editing, setEditing] = useState(true)
  const [pendingSupplierIds, setPendingSupplierIdsState] = useState<string[]>([])

  useEffect(() => {
    if (schedule) setEditing(false)
  }, [schedule])

  // 首次加载完成后（不论是否已有 schedule）先同步一次已启用供应商，
  // 之后仅在非编辑态同步，避免覆盖用户正在编辑中的多选。
  const supplierSyncedRef = useRef(false)
  useEffect(() => {
    if (scopeBinding.loading) return
    if (supplierSyncedRef.current && editing) return
    supplierSyncedRef.current = true
    setPendingSupplierIdsState(scopeBinding.enabledIds)
  }, [scopeBinding.enabledIds, scopeBinding.loading, editing])

  const startEditing = useCallback(() => setEditing(true), [])

  const cancelEditing = useCallback(() => {
    setPendingSupplierIdsState(scopeBinding.enabledIds)
    setEditing(false)
  }, [scopeBinding.enabledIds])

  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    setScheduleLoading(true)
    void loadExitAlarmSchedule().then((scheduleRes) => {
      setScheduleLoading(false)
      if (scheduleRes.ok) {
        setSchedule(scheduleRes.data)
      } else {
        showToast(`定时配置加载失败: ${scheduleRes.error}`, 'error')
      }
    })
  }, [])

  const saveSchedule = useCallback(async (draft: ExitAlarmScheduleDraft): Promise<boolean> => {
    if (!imileToken.trim()) {
      showToast('请先在全局设置中配置 iMile token，再保存定时推送', 'error')
      return false
    }
    setScheduleSaving(true)
    try {
      const res = await saveExitAlarmSchedule(draft, imileToken)
      if (res.ok) {
        setSchedule(res.data)
        showToast('定时推送配置已保存', 'success')
        return true
      }
      showToast(`保存失败: ${res.error}`, 'error')
      return false
    } finally {
      setScheduleSaving(false)
    }
  }, [imileToken])

  // 「编辑」同时作用于定时推送配置与供应商配置：保存时先提交定时配置，
  // 再提交多选的供应商范围，两者都成功才退出编辑态。
  const saveAll = useCallback(
    async (draft: ExitAlarmScheduleDraft): Promise<boolean> => {
      const scheduleOk = await saveSchedule(draft)
      if (!scheduleOk) return false
      const supplierOk = await scopeBinding.persist(pendingSupplierIds)
      if (!supplierOk) return false
      setEditing(false)
      return true
    },
    [saveSchedule, scopeBinding, pendingSupplierIds],
  )

  const pushableConfigs = catalog.configs.filter((c) => c.webhookUrl.trim().length > 0)

  return {
    catalog,
    scopeBinding,
    scheduledPushConfigs: scopeBinding.enabledPushable,
    pushableConfigs,
    schedule,
    scheduleLoading,
    scheduleSaving,
    selectedStations,
    editing,
    startEditing,
    cancelEditing,
    pendingSupplierIds,
    setPendingSupplierIds: setPendingSupplierIdsState,
    saveAll,
  }
}
