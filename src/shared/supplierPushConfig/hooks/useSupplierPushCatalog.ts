import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSupplierPushCatalog } from '../catalogApi'
import type { SupplierPushConfig } from '../types'
import { pruneSelectedConfigIds } from '../selection'

type State = {
  configs: SupplierPushConfig[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

/**
 * 加载全局供应商配置 catalog（无业务 scope 状态）。
 * 多页面可共享；scope / 多选由各自 hook 管理。
 */
export function useSupplierPushCatalog(): State {
  const [configs, setConfigs] = useState<SupplierPushConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    const res = await loadSupplierPushCatalog()
    if (!mountedRef.current) return
    if (res.ok) {
      setConfigs(res.data)
      setError(null)
    } else {
      setError(res.error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { configs, loading, error, reload }
}

/** 在 catalog 加载后裁剪仍有效的 id 列表 */
export function usePruneConfigIdsAgainstCatalog(
  catalog: SupplierPushConfig[],
  ids: string[],
): string[] {
  return pruneSelectedConfigIds(catalog.map((c) => c.id), ids)
}
