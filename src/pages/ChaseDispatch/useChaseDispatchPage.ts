import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { useSupplierPushCatalog } from '../../shared/supplierPushConfig'
import type { ChaseDispatchSchedule, ChaseDispatchScheduleDraft } from './chaseDispatchTypes'
import {
  createChaseDispatchSchedule,
  deleteChaseDispatchSchedule,
  loadChaseDispatchSchedules,
  triggerChaseDispatchSchedulePushNow,
  updateChaseDispatchSchedule,
} from './chaseDispatchApi'

export function useChaseDispatchPage() {
  const { imileToken } = useAppSettings()

  const catalog = useSupplierPushCatalog()

  const [schedules, setSchedules] = useState<ChaseDispatchSchedule[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pushingId, setPushingId] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<ChaseDispatchSchedule | null>(null)

  const initRef = useRef(false)

  const reload = useCallback(async () => {
    setSchedulesLoading(true)
    const res = await loadChaseDispatchSchedules()
    setSchedulesLoading(false)
    if (res.ok) {
      setSchedules(res.data)
    } else {
      showToast(`催派推送配置加载失败: ${res.error}`, 'error')
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

  const openEditDrawer = useCallback((schedule: ChaseDispatchSchedule) => {
    setEditingSchedule(schedule)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setEditingSchedule(null)
  }, [])

  const submitDrawer = useCallback(
    async (draft: ChaseDispatchScheduleDraft): Promise<boolean> => {
      if (!imileToken.trim()) {
        showToast('请先在全局设置中配置 iMile token，再保存催派推送', 'error')
        return false
      }
      setSaving(true)
      try {
        const res = editingSchedule
          ? await updateChaseDispatchSchedule(editingSchedule.id, draft, imileToken)
          : await createChaseDispatchSchedule(draft, imileToken)
        if (res.ok) {
          showToast(editingSchedule ? '催派推送已更新' : '催派推送已添加', 'success')
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
    async (schedule: ChaseDispatchSchedule, isEnabled: boolean) => {
      const draft: ChaseDispatchScheduleDraft = {
        weekdays: schedule.weekdays,
        pushTimes: schedule.pushTimes,
        stagnationBuckets: schedule.stagnationBuckets,
        isEnabled,
        stationCode: schedule.stationCode,
        pushConfigIds: schedule.pushConfigIds,
        mentionEnabled: schedule.mentionEnabled,
      }
      const res = await updateChaseDispatchSchedule(schedule.id, draft, imileToken)
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
      const res = await deleteChaseDispatchSchedule(id)
      if (res.ok) {
        showToast('已删除', 'success')
        await reload()
      } else {
        showToast(`删除失败: ${res.error}`, 'error')
      }
    },
    [reload],
  )

  const pushNow = useCallback(async (schedule: ChaseDispatchSchedule) => {
    if (!schedule.hasImileToken) {
      showToast('缺少 iMile token，请编辑该配置并重新保存', 'error')
      return
    }
    if (schedule.pushConfigIds.length === 0) {
      showToast('请先为该配置选择供应商', 'error')
      return
    }
    if (schedule.stagnationBuckets.length === 0) {
      showToast('请先为该配置选择滞留时间', 'error')
      return
    }
    setPushingId(schedule.id)
    try {
      const res = await triggerChaseDispatchSchedulePushNow(schedule.id)
      if (!res.ok) {
        showToast(`推送失败: ${res.error}`, 'error')
        return
      }
      const { pushedCount, totalConfigs, errors } = res.data
      if (errors.length > 0) {
        showToast(
          `已推送 ${pushedCount}/${totalConfigs}，部分失败: ${errors.slice(0, 2).join('；')}`,
          'error',
        )
      } else {
        showToast(`推送完成 ${pushedCount}/${totalConfigs}`, 'success')
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
