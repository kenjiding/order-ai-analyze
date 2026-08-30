import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from 'antd'
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
  const { message, modal } = App.useApp()
  // 配置抽屉勾选供应商用的目录，与派签告警同一份数据源
  const catalog = useSupplierPushCatalog()

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
      message.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [message])

  useEffect(() => {
    // 进入页面即加载配置列表；只读已存的统计结果，不触发任何拉数
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
          message.success('已更新')
        } else {
          await createDispatchPerformanceConfig(draft)
          message.success('已添加，次日起自动统计该站点')
        }
        setDrawerOpen(false)
        await load()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '保存失败')
      } finally {
        setSaving(false)
      }
    },
    [editing, load, message],
  )

  const toggleEnabled = useCallback(
    async (config: DispatchPerformanceConfig, isEnabled: boolean) => {
      setTogglingIds((ids) => [...ids, config.id])
      try {
        await updateDispatchPerformanceConfig(config.id, { isEnabled })
        await load()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '操作失败')
      } finally {
        setTogglingIds((ids) => ids.filter((id) => id !== config.id))
      }
    },
    [load, message],
  )

  const removeConfig = useCallback(
    (config: DispatchPerformanceConfig) => {
      modal.confirm({
        title: `删除「${config.stationName || config.stationCode}」的统计配置？`,
        // 说清楚删除的边界：停的是今后的统计，历史数据仍在
        content: '删除后该站点不再参与每日结算。已统计出的历史数据会保留，重新添加即可继续查看。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteDispatchPerformanceConfig(config.id)
            message.success('已删除')
            await load()
          } catch (err) {
            message.error(err instanceof Error ? err.message : '删除失败')
          }
        },
      })
    },
    [load, message, modal],
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
