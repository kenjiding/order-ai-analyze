import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export function useDispatchAlarmPage() {
  const { t } = useTranslation('dispatchAlarm')
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

  const crud = useScheduleListCrud<DispatchAlarmSchedule, DispatchAlarmScheduleDraft>(
    {
      load: loadDispatchAlarmSchedules,
      create: createDispatchAlarmSchedule,
      update: updateDispatchAlarmSchedule,
      remove: deleteDispatchAlarmSchedule,
    },
    messages,
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
        arrivalScanDates: schedule.arrivalScanDates,
        mentionEnabled: schedule.mentionEnabled,
        showDriverMap: schedule.showDriverMap,
        importantNotice: schedule.importantNotice,
      }
      return crud.toggleEnabled(schedule, draft, imileToken)
    },
    [crud, imileToken],
  )

  const pushNow = useCallback(
    async (schedule: DispatchAlarmSchedule) => {
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
        const res = await triggerDispatchAlarmSchedulePushNow(schedule.id)
        if (!res.ok) {
          showToast(t('toast.pushFailed', { error: res.error }), 'error')
          return
        }
        const { pushedCount, totalConfigs, errors, date } = res.data
        if (errors.length > 0) {
          showToast(
            t('toast.pushPartial', {
              pushed: pushedCount,
              total: totalConfigs,
              date,
              errors: errors.slice(0, 2).join('；'),
            }),
            'error',
          )
        } else {
          showToast(t('toast.pushComplete', { pushed: pushedCount, total: totalConfigs, date }), 'success')
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
  }
}
