import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import {
  useSupplierConfigScopeBinding,
  useSupplierPushCatalog,
} from '../../shared/supplierPushConfig'
import type { ChaseDispatchSchedule, ChaseDispatchScheduleDraft } from './chaseDispatchTypes'
import { loadChaseDispatchSchedule, saveChaseDispatchSchedule } from './chaseDispatchApi'

const CHASE_DISPATCH_SCHEDULED_SCOPE = 'chase-dispatch.scheduled' as const

export function useChaseDispatchPage() {
  const { imileToken } = useAppSettings()
  const { selectedStations } = useGlobalFilterStore()

  const catalog = useSupplierPushCatalog()
  const scopeBinding = useSupplierConfigScopeBinding(CHASE_DISPATCH_SCHEDULED_SCOPE, catalog.configs)

  const [schedule, setSchedule] = useState<ChaseDispatchSchedule | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)

  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    setScheduleLoading(true)
    void loadChaseDispatchSchedule().then((scheduleRes) => {
      setScheduleLoading(false)
      if (scheduleRes.ok) {
        setSchedule(scheduleRes.data)
      } else {
        showToast(`定时配置加载失败: ${scheduleRes.error}`, 'error')
      }
    })
  }, [])

  const saveSchedule = useCallback(
    async (draft: ChaseDispatchScheduleDraft): Promise<boolean> => {
      if (!imileToken.trim()) {
        showToast('请先在全局设置中配置 iMile token，再保存定时推送', 'error')
        return false
      }
      setScheduleSaving(true)
      try {
        const res = await saveChaseDispatchSchedule(draft, imileToken)
        if (res.ok) {
          setSchedule(res.data)
          scopeBinding.setEnabledIds(res.data.pushConfigIds)
          showToast('定时推送配置已保存', 'success')
          return true
        }
        showToast(`保存失败: ${res.error}`, 'error')
        return false
      } finally {
        setScheduleSaving(false)
      }
    },
    [imileToken, scopeBinding],
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
    saveSchedule,
  }
}
