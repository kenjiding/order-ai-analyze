import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { useSupplierPushCatalog } from '../../shared/supplierPushConfig'
import { useScheduleListCrud, type ScheduleListCrudMessages } from '../../shared/schedulePush'
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
  const { t } = useTranslation('exitAlarm')
  const { imileToken } = useAppSettings()

  const catalog = useSupplierPushCatalog()

  const messages = useMemo<ScheduleListCrudMessages>(
    () => ({
      missingImileToken: t('toast.missingImileTokenBeforeSave'),
      loadError: t('toast.loadError'),
      createSuccess: t('toast.createSuccess'),
      updateSuccess: t('toast.updateSuccess'),
      saveError: t('toast.saveError'),
      deleteSuccess: t('toast.deleteSuccess'),
      deleteError: t('toast.deleteError'),
      toggleError: t('toast.toggleError'),
    }),
    [t],
  )

  const crud = useScheduleListCrud<ExitAlarmSchedule, ExitAlarmScheduleDraft>(
    {
      load: loadExitAlarmSchedules,
      create: createExitAlarmSchedule,
      update: updateExitAlarmSchedule,
      remove: deleteExitAlarmSchedule,
    },
    messages,
  )

  const [pushingId, setPushingId] = useState<string | null>(null)
  /** 每条配置最近一次「立刻推送」结果，用于展示「导出Excel」 */
  const [pushResults, setPushResults] = useState<Record<string, ExitAlarmPushNowResult>>({})

  const submitDrawer = useCallback(
    (draft: ExitAlarmScheduleDraft) => crud.submitDrawer(draft, imileToken),
    [crud, imileToken],
  )

  const toggleEnabled = useCallback(
    (schedule: ExitAlarmSchedule, isEnabled: boolean) => {
      const draft: ExitAlarmScheduleDraft = {
        weekdays: schedule.weekdays,
        pushTimes: schedule.pushTimes,
        isEnabled,
        stationCode: schedule.stationCode,
        pushConfigIds: schedule.pushConfigIds,
        mentionEnabled: schedule.mentionEnabled,
        routeCodeWhitelistPushEnabled: schedule.routeCodeWhitelistPushEnabled,
        arrivalScanDates: schedule.arrivalScanDates,
        clearancePrice: schedule.clearancePrice,
        importantNotice: schedule.importantNotice,
      }
      return crud.toggleEnabled(schedule, draft, imileToken)
    },
    [crud, imileToken],
  )

  const pushNow = useCallback(
    async (schedule: ExitAlarmSchedule) => {
      if (!schedule.hasImileToken) {
        showToast(t('toast.missingImileTokenResave'), 'error')
        return
      }
      if (schedule.pushConfigIds.length === 0) {
        showToast(t('toast.selectVendorFirst'), 'error')
        return
      }
      setPushingId(schedule.id)
      try {
        const res = await triggerExitAlarmSchedulePushNow(schedule.id)
        if (!res.ok) {
          showToast(t('toast.pushFailed', { error: res.error }), 'error')
          return
        }
        const { pushedCount, totalConfigs, errors, dates } = res.data
        const date = dates.join(' / ')
        setPushResults((prev) => ({ ...prev, [schedule.id]: res.data }))
        if (errors.length > 0) {
          showToast(
            t('toast.pushPartial', {
              pushed: pushedCount,
              total: totalConfigs,
              dates: date,
              errors: errors.slice(0, 2).join('；'),
            }),
            'error',
          )
        } else {
          showToast(t('toast.pushComplete', { pushed: pushedCount, total: totalConfigs, dates: date }), 'success')
        }
      } finally {
        setPushingId(null)
      }
    },
    [t],
  )

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
    pushResults,
  }
}
