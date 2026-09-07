import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSupplierPushCatalog } from '../../shared/supplierPushConfig'
import {
  createDispatchPerformanceConfig,
  deleteDispatchPerformanceConfig,
  fetchDispatchPerformanceConfigs,
  updateDispatchPerformanceConfig,
} from './dispatchPerformanceApi'
import type {
  DispatchPerformanceConfig,
  DispatchPerformanceConfigDraft,
} from './dispatchPerformanceTypes'

/**
 * 配置列表页：管理「哪些站点开启每日结算」，并把各站点最近一批结算概览摆出来。
 * 统计本身完全由定时任务产出，这里不触发任何拉数。
 */
export function useDispatchPerformancePage() {
  const { t } = useTranslation(['dispatchPerformance', 'common'])
  const { message, modal } = App.useApp()
  const catalog = useSupplierPushCatalog()

  const toast = useMemo(
    () => ({
      loadError: t('toast.loadError', { ns: 'dispatchPerformance' }),
      updateSuccess: t('toast.updateSuccess', { ns: 'dispatchPerformance' }),
      createSuccess: t('toast.createSuccess', { ns: 'dispatchPerformance' }),
      saveError: t('toast.saveError', { ns: 'dispatchPerformance' }),
      toggleError: t('toast.toggleError', { ns: 'dispatchPerformance' }),
      deleteSuccess: t('toast.deleteSuccess', { ns: 'dispatchPerformance' }),
      deleteError: t('toast.deleteError', { ns: 'dispatchPerformance' }),
    }),
    [t],
  )

  const [configs, setConfigs] = useState<DispatchPerformanceConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [togglingIds, setTogglingIds] = useState<string[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<DispatchPerformanceConfig | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const data = await fetchDispatchPerformanceConfigs(controller.signal)
      if (!controller.signal.aborted) setConfigs(data)
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
      message.error(err instanceof Error ? err.message : toast.loadError)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [message, toast.loadError])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => () => abortRef.current?.abort(), [])

  const openCreateDrawer = useCallback(() => {
    setEditing(null)
    setDrawerOpen(true)
  }, [])

  const openEditDrawer = useCallback((config: DispatchPerformanceConfig) => {
    setEditing(config)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  const submitDrawer = useCallback(
    async (draft: DispatchPerformanceConfigDraft) => {
      setSaving(true)
      try {
        if (editing) {
          await updateDispatchPerformanceConfig(editing.id, draft)
          message.success(toast.updateSuccess)
        } else {
          await createDispatchPerformanceConfig(draft)
          message.success(toast.createSuccess)
        }
        setDrawerOpen(false)
        await load()
      } catch (err) {
        message.error(err instanceof Error ? err.message : toast.saveError)
      } finally {
        setSaving(false)
      }
    },
    [editing, load, message, toast.createSuccess, toast.saveError, toast.updateSuccess],
  )

  const toggleEnabled = useCallback(
    async (config: DispatchPerformanceConfig, isEnabled: boolean) => {
      setTogglingIds((ids) => [...ids, config.id])
      try {
        await updateDispatchPerformanceConfig(config.id, { isEnabled })
        await load()
      } catch (err) {
        message.error(err instanceof Error ? err.message : toast.toggleError)
      } finally {
        setTogglingIds((ids) => ids.filter((id) => id !== config.id))
      }
    },
    [load, message, toast.toggleError],
  )

  const removeConfig = useCallback(
    (config: DispatchPerformanceConfig) => {
      modal.confirm({
        title: t('toast.deleteConfirmTitle', {
          ns: 'dispatchPerformance',
          name: config.stationName || config.stationCode,
        }),
        content: t('toast.deleteConfirmContent', { ns: 'dispatchPerformance' }),
        okText: t('delete', { ns: 'common' }),
        okButtonProps: { danger: true },
        cancelText: t('cancel', { ns: 'common' }),
        onOk: async () => {
          try {
            await deleteDispatchPerformanceConfig(config.id)
            message.success(toast.deleteSuccess)
            await load()
          } catch (err) {
            message.error(err instanceof Error ? err.message : toast.deleteError)
          }
        },
      })
    },
    [load, message, modal, t, toast.deleteError, toast.deleteSuccess],
  )

  return {
    catalog,
    configs,
    loading,
    saving,
    togglingIds,
    drawerOpen,
    editing,
    openCreateDrawer,
    openEditDrawer,
    closeDrawer,
    submitDrawer,
    toggleEnabled,
    removeConfig,
    reload: load,
  }
}
