import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { useSupplierPushCatalog } from '../../shared/supplierPushConfig'
import type { DispatchAlarmSchedule, DispatchAlarmScheduleDraft } from './dispatchAlarmTypes'
import {
  createDispatchAlarmSchedule,
  deleteDispatchAlarmSchedule,
  loadDispatchAlarmSchedules,
  triggerDispatchAlarmSchedulePushNow,
  updateDispatchAlarmSchedule,
} from './dispatchAlarmApi'

export function useDispatchAlarmPage() {
  const { imileToken } = useAppSettings()

  const catalog = useSupplierPushCatalog()

  const [schedules, setSchedules] = useState<DispatchAlarmSchedule[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pushingId, setPushingId] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<DispatchAlarmSchedule | null>(null)

  const initRef = useRef(false)

  const reload = useCallback(async () => {
    setSchedulesLoading(true)
    const res = await loadDispatchAlarmSchedules()
    setSchedulesLoading(false)
    if (res.ok) {
      setSchedules(res.data)
    } else {
      showToast(`派签告警配置加载失败: ${res.error}`, 'error')
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

  const openEditDrawer = useCallback((schedule: DispatchAlarmSchedule) => {
    setEditingSchedule(schedule)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setEditingSchedule(null)
  }, [])

  const submitDrawer = useCallback(
    async (draft: DispatchAlarmScheduleDraft): Promise<boolean> => {
      if (!imileToken.trim()) {
        showToast('请先在全局设置中配置 iMile token，再保存派签告警', 'error')
        return false
      }
      setSaving(true)
      try {
        const res = editingSchedule
          ? await updateDispatchAlarmSchedule(editingSchedule.id, draft, imileToken)
          : await createDispatchAlarmSchedule(draft, imileToken)
        if (res.ok) {
          showToast(editingSchedule ? '派签告警已更新' : '派签告警已添加', 'success')
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
    async (schedule: DispatchAlarmSchedule, isEnabled: boolean) => {
      const draft: DispatchAlarmScheduleDraft = {
        weekdays: schedule.weekdays,
        pushTimes: schedule.pushTimes,
        isEnabled,
        stationCode: schedule.stationCode,
        alertThresholdPct: schedule.alertThresholdPct,
        pushConfigIds: schedule.pushConfigIds,
        arrivalScanDate: schedule.arrivalScanDate,
        mentionEnabled: schedule.mentionEnabled,
      }
      const res = await updateDispatchAlarmSchedule(schedule.id, draft, imileToken)
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
      const res = await deleteDispatchAlarmSchedule(id)
      if (res.ok) {
        showToast('已删除', 'success')
        await reload()
      } else {
        showToast(`删除失败: ${res.error}`, 'error')
      }
    },
    [reload],
  )

  const pushNow = useCallback(async (schedule: DispatchAlarmSchedule) => {
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
      const res = await triggerDispatchAlarmSchedulePushNow(schedule.id)
      if (!res.ok) {
        showToast(`推送失败: ${res.error}`, 'error')
        return
      }
      const { pushedCount, totalConfigs, errors, date } = res.data
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
  }
}
