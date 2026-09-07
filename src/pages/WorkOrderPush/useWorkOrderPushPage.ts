import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import { useSupplierPushCatalog } from '../../shared/supplierPushConfig'
import { useScheduleListCrud, type ScheduleListCrudMessages } from '../../shared/schedulePush'
import type { WorkOrderPushSchedule, WorkOrderPushScheduleDraft } from './workOrderPushTypes'
import {
  createWorkOrderPushSchedule,
  deleteWorkOrderPushSchedule,
  loadWorkOrderPushSchedules,
  triggerWorkOrderPushSchedulePushNow,
  updateWorkOrderPushSchedule,
} from './workOrderPushApi'

export function useWorkOrderPushPage() {
  const { t } = useTranslation('workOrderPush')
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

  const crud = useScheduleListCrud<WorkOrderPushSchedule, WorkOrderPushScheduleDraft>(
    {
      load: loadWorkOrderPushSchedules,
      create: createWorkOrderPushSchedule,
      update: updateWorkOrderPushSchedule,
      remove: deleteWorkOrderPushSchedule,
    },
    messages,
  )

  const [pushingId, setPushingId] = useState<string | null>(null)

  const submitDrawer = useCallback(
    (draft: WorkOrderPushScheduleDraft) => crud.submitDrawer(draft, imileToken),
    [crud, imileToken],
  )

  const toggleEnabled = useCallback(
    (schedule: WorkOrderPushSchedule, isEnabled: boolean) => {
      const draft: WorkOrderPushScheduleDraft = {
        weekdays: schedule.weekdays,
        pushTimes: schedule.pushTimes,
        isEnabled,
        stationCode: schedule.stationCode,
        pushConfigIds: schedule.pushConfigIds,
        mentionEnabled: schedule.mentionEnabled,
      }
      return crud.toggleEnabled(schedule, draft, imileToken)
    },
    [crud, imileToken],
  )

  const pushNow = useCallback(
    async (schedule: WorkOrderPushSchedule) => {
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
        const res = await triggerWorkOrderPushSchedulePushNow(schedule.id)
        if (!res.ok) {
          showToast(t('toast.pushFailed', { error: res.error }), 'error')
          return
        }
        const { pushedCount, totalConfigs, errors } = res.data
        if (errors.length > 0) {
          showToast(
            t('toast.pushPartial', {
              pushed: pushedCount,
              total: totalConfigs,
              errors: errors.slice(0, 2).join('；'),
            }),
            'error',
          )
        } else {
          showToast(t('toast.pushComplete', { pushed: pushedCount, total: totalConfigs }), 'success')
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
