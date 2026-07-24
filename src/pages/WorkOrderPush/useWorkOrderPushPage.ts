import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { useSupplierPushCatalog } from '../../shared/supplierPushConfig'
import type { WorkOrderPushSchedule, WorkOrderPushScheduleDraft } from './workOrderPushTypes'
import {
  createWorkOrderPushSchedule,
  deleteWorkOrderPushSchedule,
  loadWorkOrderPushSchedules,
  triggerWorkOrderPushSchedulePushNow,
  updateWorkOrderPushSchedule,
} from './workOrderPushApi'

export function useWorkOrderPushPage() {
  const { imileToken } = useAppSettings()

  const catalog = useSupplierPushCatalog()

  const [schedules, setSchedules] = useState<WorkOrderPushSchedule[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pushingId, setPushingId] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<WorkOrderPushSchedule | null>(null)

  const initRef = useRef(false)

  const reload = useCallback(async () => {
    setSchedulesLoading(true)
    const res = await loadWorkOrderPushSchedules()
    setSchedulesLoading(false)
    if (res.ok) {
      setSchedules(res.data)
    } else {
      showToast(`工单推送配置加载失败: ${res.error}`, 'error')
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

  const openEditDrawer = useCallback((schedule: WorkOrderPushSchedule) => {
    setEditingSchedule(schedule)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setEditingSchedule(null)
  }, [])

  const submitDrawer = useCallback(
    async (draft: WorkOrderPushScheduleDraft): Promise<boolean> => {
      if (!imileToken.trim()) {
        showToast('请先在全局设置中配置 iMile token，再保存工单推送', 'error')
        return false
      }
      setSaving(true)
      try {
        const res = editingSchedule
          ? await updateWorkOrderPushSchedule(editingSchedule.id, draft, imileToken)
          : await createWorkOrderPushSchedule(draft, imileToken)
        if (res.ok) {
          showToast(editingSchedule ? '工单推送已更新' : '工单推送已添加', 'success')
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
    async (schedule: WorkOrderPushSchedule, isEnabled: boolean) => {
      const draft: WorkOrderPushScheduleDraft = {
        pushTimes: schedule.pushTimes,
        isEnabled,
        stationCode: schedule.stationCode,
        pushConfigIds: schedule.pushConfigIds,
      }
      const res = await updateWorkOrderPushSchedule(schedule.id, draft, imileToken)
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
      const res = await deleteWorkOrderPushSchedule(id)
      if (res.ok) {
        showToast('已删除', 'success')
        await reload()
      } else {
        showToast(`删除失败: ${res.error}`, 'error')
      }
    },
    [reload],
  )

  const pushNow = useCallback(async (schedule: WorkOrderPushSchedule) => {
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
      const res = await triggerWorkOrderPushSchedulePushNow(schedule.id)
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
  }
}
