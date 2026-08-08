import { useCallback, useEffect, useRef, useState } from 'react'
import { showToast } from '../../../utils/toast'
import { getSupplierConfigScopeAdapter } from '../scopes/adapters'
import {
  isSupplierPushEligible,
  pruneSelectedConfigIds,
  toggleScopeEnabledId,
} from '../selection'
import type { SupplierConfigScopeKey, SupplierPushConfig } from '../types'

type Options = {
  /** 为 false 时不自动拉取（例如等 catalog 就绪后再开） */
  enabled?: boolean
  onEnabledIdsChange?: (ids: string[]) => void
}

/**
 * 业务 scope 持久化启用列表（Switch / 定时任务等）。
 * 与 catalog 解耦：只读写 enabled id，不修改主配置。
 */
export function useSupplierConfigScopeBinding(
  scopeKey: SupplierConfigScopeKey,
  catalog: SupplierPushConfig[],
  options: Options = {},
) {
  const { enabled = true, onEnabledIdsChange } = options
  const adapter = getSupplierConfigScopeAdapter(scopeKey)

  const [enabledIds, setEnabledIdsState] = useState<string[]>([])
  const [loading, setLoading] = useState(enabled)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const applyEnabledIds = useCallback(
    (ids: string[]) => {
      const pruned = pruneSelectedConfigIds(catalog.map((c) => c.id), ids)
      setEnabledIdsState(pruned)
      onEnabledIdsChange?.(pruned)
      return pruned
    },
    [catalog, onEnabledIdsChange],
  )

  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    const res = await adapter.loadEnabledIds()
    if (!mountedRef.current) return
    if (res.ok) {
      applyEnabledIds(res.enabledIds)
    } else {
      showToast(`加载「${scopeKey}」启用列表失败：${res.error}`, 'error')
    }
    setLoading(false)
  }, [adapter, applyEnabledIds, enabled, scopeKey])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!catalog.length) return
    setEnabledIdsState((prev) => pruneSelectedConfigIds(catalog.map((c) => c.id), prev))
  }, [catalog])

  const persist = useCallback(
    async (nextIds: string[]) => {
      setSaving(true)
      try {
        const res = await adapter.saveEnabledIds(nextIds)
        if (!mountedRef.current) return false
        if (res.ok) {
          applyEnabledIds(res.enabledIds)
          return true
        }
        showToast(`保存「${scopeKey}」启用列表失败：${res.error}`, 'error')
        return false
      } finally {
        if (mountedRef.current) setSaving(false)
      }
    },
    [adapter, applyEnabledIds, scopeKey],
  )

  const toggle = useCallback(
    async (configId: string, nextEnabled: boolean) => {
      if (saving || togglingId) return false
      const row = catalog.find((c) => c.id === configId)
      if (nextEnabled && row && !isSupplierPushEligible(row)) {
        showToast('该供应商未配置 Webhook 或飞书群 Chat ID，无法启用', 'warning')
        return false
      }
      const nextIds = toggleScopeEnabledId(enabledIds, configId, nextEnabled)
      setTogglingId(configId)
      try {
        return await persist(nextIds)
      } finally {
        if (mountedRef.current) setTogglingId(null)
      }
    },
    [catalog, enabledIds, persist, saving, togglingId],
  )

  const enabledPushable = catalog.filter(
    (c) => enabledIds.includes(c.id) && isSupplierPushEligible(c),
  )

  return {
    enabledIds,
    setEnabledIds: applyEnabledIds,
    enabledPushable,
    loading,
    saving,
    togglingId,
    toggle,
    persist,
    reload,
  }
}
