import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { listPushableSupplierPushConfigsByIds } from '../supplierPushConfigs'
import { getSupplierConfigScopeStore, isSupplierConfigScopeKey } from '../supplierConfigScopes/registry'
import type { SupplierConfigScopeKey } from '../supplierConfigScopes/types'

export const supplierConfigScopeRouter = Router()

function parseScopeKey(raw: string): SupplierConfigScopeKey | null {
  const key = raw.trim()
  return isSupplierConfigScopeKey(key) ? key : null
}

/** 读取某业务 scope 已启用的供应商 config id 列表 */
supplierConfigScopeRouter.get('/:scopeKey/enabled-ids', async (req: AuthenticatedRequest, res: Response) => {
  const scopeKey = parseScopeKey(String(req.params.scopeKey ?? ''))
  if (!scopeKey) {
    res.status(404).json({ ok: false, error: '未知的 supplier config scope' })
    return
  }
  try {
    const store = getSupplierConfigScopeStore(scopeKey)
    const enabledIds = await store.loadEnabledConfigIds()
    res.json({ ok: true, data: { scopeKey, enabledIds } })
  } catch {
    res.status(500).json({ ok: false, error: '读取 scope 启用列表失败' })
  }
})

/** 持久化某业务 scope 的启用列表（开关型业务用） */
supplierConfigScopeRouter.put('/:scopeKey/enabled-ids', async (req: AuthenticatedRequest, res: Response) => {
  const scopeKey = parseScopeKey(String(req.params.scopeKey ?? ''))
  if (!scopeKey) {
    res.status(404).json({ ok: false, error: '未知的 supplier config scope' })
    return
  }
  const body = req.body as { enabledIds?: unknown }
  const rawIds = Array.isArray(body.enabledIds) ? body.enabledIds : []
  const enabledIds = rawIds
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim())
  try {
    const store = getSupplierConfigScopeStore(scopeKey)
    const saved = await store.saveEnabledConfigIds(enabledIds)
    res.json({ ok: true, data: { scopeKey, enabledIds: saved } })
  } catch {
    res.status(500).json({ ok: false, error: '保存 scope 启用列表失败' })
  }
})

/** 解析 scope 启用列表 ∩ catalog，供定时任务等服务端逻辑使用 */
supplierConfigScopeRouter.get('/:scopeKey/pushable-configs', async (req: AuthenticatedRequest, res: Response) => {
  const scopeKey = parseScopeKey(String(req.params.scopeKey ?? ''))
  if (!scopeKey) {
    res.status(404).json({ ok: false, error: '未知的 supplier config scope' })
    return
  }
  try {
    const store = getSupplierConfigScopeStore(scopeKey)
    const enabledIds = await store.loadEnabledConfigIds()
    const configs = await listPushableSupplierPushConfigsByIds(enabledIds)
    res.json({ ok: true, data: { scopeKey, configs } })
  } catch {
    res.status(500).json({ ok: false, error: '读取 scope 可推送配置失败' })
  }
})
