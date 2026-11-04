import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import {
  createFeishuOpenApiKey,
  deleteFeishuOpenApiKey,
  listFeishuOpenApiKeys,
  setFeishuOpenApiKeyDisabled,
} from '../feishu/feishuOpenApiKeyRepository'
import type { FeishuOpenApiKey } from '../db/schema'

/**
 * 飞书推送开放 API 的 key 管理后台接口（给「API Key 管理」页面用）。
 * 只能新增/删除/启用禁用，不支持编辑已有字段。
 */
export const feishuOpenApiKeyAdminRouter = Router()

/** 列表只返回脱敏后的 token（末 4 位），完整明文只在创建那一次响应里出现一次 */
function maskToken(token: string): string {
  return token.length <= 4 ? '****' : `****${token.slice(-4)}`
}

type FeishuOpenApiKeyListItem = Omit<FeishuOpenApiKey, 'token'> & { tokenMasked: string }

function toListItem(row: FeishuOpenApiKey): FeishuOpenApiKeyListItem {
  const { token, ...rest } = row
  return { ...rest, tokenMasked: maskToken(token) }
}

feishuOpenApiKeyAdminRouter.get('/', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await listFeishuOpenApiKeys()
    res.json({ ok: true, data: rows.map(toListItem) })
  } catch {
    res.status(500).json({ ok: false, error: '读取 API Key 列表失败' })
  }
})

feishuOpenApiKeyAdminRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const name = String((req.body as { name?: unknown } | null)?.name ?? '').trim()
  if (!name) {
    res.status(400).json({ ok: false, error: '名称不能为空' })
    return
  }
  if (name.length > 200) {
    res.status(400).json({ ok: false, error: '名称过长' })
    return
  }
  try {
    const row = await createFeishuOpenApiKey(name, req.authUser?.id ?? null)
    // 完整 token 只在创建这一次返回，之后列表里永远是脱敏的
    res.json({ ok: true, data: { ...toListItem(row), token: row.token } })
  } catch {
    res.status(500).json({ ok: false, error: '创建 API Key 失败' })
  }
})

feishuOpenApiKeyAdminRouter.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const isDisabled = (req.body as { isDisabled?: unknown } | null)?.isDisabled
  if (typeof isDisabled !== 'boolean') {
    res.status(400).json({ ok: false, error: '缺少 isDisabled' })
    return
  }
  try {
    const row = await setFeishuOpenApiKeyDisabled(String(req.params.id), isDisabled)
    if (!row) {
      res.status(404).json({ ok: false, error: 'API Key 不存在' })
      return
    }
    res.json({ ok: true, data: toListItem(row) })
  } catch {
    res.status(500).json({ ok: false, error: '更新状态失败' })
  }
})

feishuOpenApiKeyAdminRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deleted = await deleteFeishuOpenApiKey(String(req.params.id))
    if (!deleted) {
      res.status(404).json({ ok: false, error: 'API Key 不存在' })
      return
    }
    res.json({ ok: true, data: { id: req.params.id } })
  } catch {
    res.status(500).json({ ok: false, error: '删除 API Key 失败' })
  }
})
