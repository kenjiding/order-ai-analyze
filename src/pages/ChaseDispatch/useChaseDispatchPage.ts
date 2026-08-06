import { useCallback, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { useSupplierPushCatalog } from '../../shared/supplierPushConfig'
import { useScheduleListCrud, type ScheduleListCrudMessages } from '../../shared/schedulePush'
import type { ChaseDispatchSchedule, ChaseDispatchScheduleDraft } from './chaseDispatchTypes'
import {
  createChaseDispatchSchedule,
  deleteChaseDispatchSchedule,
  loadChaseDispatchSchedules,
  triggerChaseDispatchSchedulePushNow,
  updateChaseDispatchSchedule,
} from './chaseDispatchApi'

const MESSAGES: ScheduleListCrudMessages = {
  missingImileToken: '请先在全局设置中配置 iMile token，再保存催派推送',
  loadError: '催派推送配置加载失败',
  createSuccess: '催派推送已添加',
  updateSuccess: '催派推送已更新',
  saveError: '保存失败',
  deleteSuccess: '已删除',
  deleteError: '删除失败',
  toggleError: '更新失败',
}

export function useChaseDispatchPage() {
  const { imileToken } = useAppSettings()

  const catalog = useSupplierPushCatalog()

  const crud = useScheduleListCrud<ChaseDispatchSchedule, ChaseDispatchScheduleDraft>(
    {
      load: loadChaseDispatchSchedules,
      create: createChaseDispatchSchedule,
      update: updateChaseDispatchSchedule,
      remove: deleteChaseDispatchSchedule,
    },
    MESSAGES,
  )

  const [pushingId, setPushingId] = useState<string | null>(null)

  const submitDrawer = useCallback(
    (draft: ChaseDispatchScheduleDraft) => crud.submitDrawer(draft, imileToken),
    [crud, imileToken],
  )

  const toggleEnabled = useCallback(
    (schedule: ChaseDispatchSchedule, isEnabled: boolean) => {
      const draft: ChaseDispatchScheduleDraft = {
        weekdays: schedule.weekdays,
        pushTimes: schedule.pushTimes,
        stagnationBuckets: schedule.stagnationBuckets,
        isEnabled,
        stationCode: schedule.stationCode,
        pushConfigIds: schedule.pushConfigIds,
        mentionEnabled: schedule.mentionEnabled,
      }
      return crud.toggleEnabled(schedule, draft, imileToken)
    },
    [crud, imileToken],
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
    schedules: crud.schedules,
    schedulesLoading: crud.schedulesLoading,
    saving: crud.saving,
    togglingIds: crud.togglingIds,
    pushingId,
    drawerOpen: crud.drawerOpen,
    editingSchedule: crud.editingSchedule,
    openCreateDrawer: crud.openCreateDrawer,
    openEditDrawer: crud.openEditDrawer,
    closeDrawer: crud.closeDrawer,
    submitDrawer,
    toggleEnabled,
    removeSchedule: crud.removeSchedule,
    pushNow,
    pushableConfigs,
  }
}
