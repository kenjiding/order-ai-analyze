import { useCallback, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { useSupplierPushCatalog } from '../../shared/supplierPushConfig'
import { useScheduleListCrud, type ScheduleListCrudMessages } from '../../shared/schedulePush'
import type { DispatchAlarmSchedule, DispatchAlarmScheduleDraft } from './dispatchAlarmTypes'
import {
  createDispatchAlarmSchedule,
  deleteDispatchAlarmSchedule,
  loadDispatchAlarmSchedules,
  triggerDispatchAlarmSchedulePushNow,
  updateDispatchAlarmSchedule,
} from './dispatchAlarmApi'

const MESSAGES: ScheduleListCrudMessages = {
  missingImileToken: '请先在全局设置中配置 iMile token，再保存派签告警',
  loadError: '派签告警配置加载失败',
  createSuccess: '派签告警已添加',
  updateSuccess: '派签告警已更新',
  saveError: '保存失败',
  deleteSuccess: '已删除',
  deleteError: '删除失败',
  toggleError: '更新失败',
}

export function useDispatchAlarmPage() {
  const { imileToken } = useAppSettings()

  const catalog = useSupplierPushCatalog()

  const crud = useScheduleListCrud<DispatchAlarmSchedule, DispatchAlarmScheduleDraft>(
    {
      load: loadDispatchAlarmSchedules,
      create: createDispatchAlarmSchedule,
      update: updateDispatchAlarmSchedule,
      remove: deleteDispatchAlarmSchedule,
    },
    MESSAGES,
  )

  const [pushingId, setPushingId] = useState<string | null>(null)

  const submitDrawer = useCallback(
    (draft: DispatchAlarmScheduleDraft) => crud.submitDrawer(draft, imileToken),
    [crud, imileToken],
  )

  const toggleEnabled = useCallback(
    (schedule: DispatchAlarmSchedule, isEnabled: boolean) => {
      const draft: DispatchAlarmScheduleDraft = {
        weekdays: schedule.weekdays,
        pushTimes: schedule.pushTimes,
        isEnabled,
        stationCode: schedule.stationCode,
        alertThresholdPct: schedule.alertThresholdPct,
        pushConfigIds: schedule.pushConfigIds,
        arrivalScanDate: schedule.arrivalScanDate,
        mentionEnabled: schedule.mentionEnabled,
        showDriverMap: schedule.showDriverMap,
      }
      return crud.toggleEnabled(schedule, draft, imileToken)
    },
    [crud, imileToken],
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
  }
}
