import { useCallback, useMemo, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { useScheduleListCrud, type ScheduleListCrudMessages } from '../../shared/schedulePush'
import type { RegionClearancePushSchedule, RegionClearancePushScheduleDraft } from './regionClearancePushTypes'
import {
  createRegionClearancePushSchedule,
  deleteRegionClearancePushSchedule,
  loadRegionClearancePushSchedules,
  triggerRegionClearancePushNow,
  updateRegionClearancePushSchedule,
} from './regionClearancePushApi'

const messages: ScheduleListCrudMessages = {
  missingImileToken: '缺少 iMile token，请先在全局设置中配置',
  loadError: '加载配置失败',
  createSuccess: '新增配置成功',
  updateSuccess: '保存配置成功',
  saveError: '保存配置失败',
  deleteSuccess: '删除配置成功',
  deleteError: '删除配置失败',
  toggleError: '切换启用状态失败',
}

export function useRegionClearancePushPage() {
  const { imileToken } = useAppSettings()

  const crud = useScheduleListCrud<RegionClearancePushSchedule, RegionClearancePushScheduleDraft>(
    {
      load: loadRegionClearancePushSchedules,
      create: createRegionClearancePushSchedule,
      update: updateRegionClearancePushSchedule,
      remove: deleteRegionClearancePushSchedule,
    },
    messages,
  )

  const [pushingId, setPushingId] = useState<string | null>(null)

  const submitDrawer = useCallback(
    (draft: RegionClearancePushScheduleDraft) => crud.submitDrawer(draft, imileToken),
    [crud, imileToken],
  )

  const toggleEnabled = useCallback(
    (schedule: RegionClearancePushSchedule, isEnabled: boolean) => {
      const draft: RegionClearancePushScheduleDraft = {
        regionCode: schedule.regionCode,
        regionName: schedule.regionName,
        stationCodes: schedule.stationCodes,
        weekdays: schedule.weekdays,
        pushTimes: schedule.pushTimes,
        isEnabled,
        chatId: schedule.chatId,
        mentionOpenIds: schedule.mentionOpenIds,
      }
      return crud.toggleEnabled(schedule, draft, imileToken)
    },
    [crud, imileToken],
  )

  const pushNow = useCallback(async (schedule: RegionClearancePushSchedule) => {
    if (!schedule.hasImileToken) {
      showToast('缺少 iMile token，请编辑该配置并重新保存', 'error')
      return
    }
    setPushingId(schedule.id)
    try {
      const res = await triggerRegionClearancePushNow(schedule.id)
      if (!res.ok) {
        showToast(`推送失败: ${res.error}`, 'error')
        return
      }
      showToast('推送成功', 'success')
    } finally {
      setPushingId(null)
    }
  }, [])

  return useMemo(
    () => ({
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
    }),
    [crud, pushingId, submitDrawer, toggleEnabled, pushNow],
  )
}
