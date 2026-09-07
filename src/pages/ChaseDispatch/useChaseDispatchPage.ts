import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export function useChaseDispatchPage() {
  const { t } = useTranslation('chaseDispatch')
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

  const crud = useScheduleListCrud<ChaseDispatchSchedule, ChaseDispatchScheduleDraft>(
    {
      load: loadChaseDispatchSchedules,
      create: createChaseDispatchSchedule,
      update: updateChaseDispatchSchedule,
      remove: deleteChaseDispatchSchedule,
    },
    messages,
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

  const pushNow = useCallback(
    async (schedule: ChaseDispatchSchedule) => {
      if (!schedule.hasImileToken) {
        showToast(t('toast.missingImileTokenResave'), 'error')
        return
      }
      if (schedule.pushConfigIds.length === 0) {
        showToast(t('toast.selectVendorFirst'), 'error')
        return
      }
      if (schedule.stagnationBuckets.length === 0) {
        showToast(t('toast.selectDwellDurationFirst'), 'error')
        return
      }
      setPushingId(schedule.id)
      try {
        const res = await triggerChaseDispatchSchedulePushNow(schedule.id)
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
