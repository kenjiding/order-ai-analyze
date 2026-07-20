import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { useSupplierPushCatalog } from '../../shared/supplierPushConfig'
import type { ExitAlarmSchedule, ExitAlarmScheduleDraft } from './exitAlarmTypes'
import {
  createExitAlarmSchedule,
  deleteExitAlarmSchedule,
  loadExitAlarmSchedules,
  triggerExitAlarmSchedulePushNow,
  updateExitAlarmSchedule,
  type ExitAlarmPushNowResult,
} from './exitAlarmApi'

export function useExitAlarmPage() {
  const { imileToken } = useAppSettings()

  const catalog = useSupplierPushCatalog()

  const [schedules, setSchedules] = useState<ExitAlarmSchedule[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pushingId, setPushingId] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<ExitAlarmSchedule | null>(null)
  /** 每条配置最近一次「立刻推送」结果，用于展示「导出Excel」 */
  const [pushResults, setPushResults] = useState<Record<string, ExitAlarmPushNowResult>>({})

  const initRef = useRef(false)

  const reload = useCallback(async () => {
    setSchedulesLoading(true)
    const res = await loadExitAlarmSchedules()
    setSchedulesLoading(false)
    if (res.ok) {
      setSchedules(res.data)
    } else {
      showToast(`出仓告警配置加载失败: ${res.error}`, 'error')
    }
  }, [])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    void reload()
  }, [reload])

  const openCreateDrawer = useCallback(() => {
    setEditingSchedule(null)
    setDrawerOpen(true)
  }, [])

  const openEditDrawer = useCallback((schedule: ExitAlarmSchedule) => {
    setEditingSchedule(schedule)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setEditingSchedule(null)
  }, [])

  const submitDrawer = useCallback(
    async (draft: ExitAlarmScheduleDraft): Promise<boolean> => {
      if (!imileToken.trim()) {
        showToast('请先在全局设置中配置 iMile token，再保存出仓告警', 'error')
        return false
      }
      setSaving(true)
      try {
        const res = editingSchedule
          ? await updateExitAlarmSchedule(editingSchedule.id, draft, imileToken)
          : await createExitAlarmSchedule(draft, imileToken)
        if (res.ok) {
          showToast(editingSchedule ? '出仓告警已更新' : '出仓告警已添加', 'success')
          await reload()
          return true
        }
        showToast(`保存失败: ${res.error}`, 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [editingSchedule, imileToken, reload],
  )

  const toggleEnabled = useCallback(
    async (schedule: ExitAlarmSchedule, isEnabled: boolean) => {
      const draft: ExitAlarmScheduleDraft = {
        weekdays: schedule.weekdays,
        pushTimes: schedule.pushTimes,
        isEnabled,
        stationCode: schedule.stationCode,
        pushConfigIds: schedule.pushConfigIds,
      }
      const res = await updateExitAlarmSchedule(schedule.id, draft, imileToken)
      if (res.ok) {
        await reload()
      } else {
        showToast(`更新失败: ${res.error}`, 'error')
      }
    },
    [imileToken, reload],
  )

  const removeSchedule = useCallback(
    async (id: string) => {
      const res = await deleteExitAlarmSchedule(id)
      if (res.ok) {
        showToast('已删除', 'success')
        await reload()
      } else {
        showToast(`删除失败: ${res.error}`, 'error')
      }
    },
    [reload],
  )

  const pushNow = useCallback(async (schedule: ExitAlarmSchedule) => {
    if (!schedule.hasImileToken) {
      showToast('缺少 iMile token，请编辑该配置并重新保存', 'error')
      return
    }
    if (schedule.pushConfigIds.length === 0) {
      showToast('请先为该配置选择供应商', 'error')
      return
    }
    setPushingId(schedule.id)
    try {
      const res = await triggerExitAlarmSchedulePushNow(schedule.id)
      if (!res.ok) {
        showToast(`推送失败: ${res.error}`, 'error')
        return
      }
      const { pushedCount, totalConfigs, errors, date } = res.data
      setPushResults((prev) => ({ ...prev, [schedule.id]: res.data }))
      if (errors.length > 0) {
        showToast(
          `已推送 ${pushedCount}/${totalConfigs}（数据日 ${date}），部分失败: ${errors.slice(0, 2).join('；')}`,
          'error',
        )
      } else {
        showToast(`推送完成 ${pushedCount}/${totalConfigs}（数据日 ${date}）`, 'success')
      }
    } finally {
      setPushingId(null)
    }
  }, [])

  const pushableConfigs = catalog.configs.filter((c) => c.webhookUrl.trim().length > 0)

  return {
    catalog,
    schedules,
    schedulesLoading,
    saving,
    pushingId,
    drawerOpen,
    editingSchedule,
    openCreateDrawer,
    openEditDrawer,
    closeDrawer,
    submitDrawer,
    toggleEnabled,
    removeSchedule,
    pushNow,
    pushableConfigs,
    pushResults,
  }
}
