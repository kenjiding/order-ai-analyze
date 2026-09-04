import { Router, type Response } from 'express'
import { asc, eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import type { PriorityClient } from '../db/schema'

export const priorityClientsRouter = Router()

type ClientDraft = {
  clientCode: string
  clientName: string
  isVip: boolean
}

/** 解析请求体；返回字符串表示校验失败原因 */
function parseDraft(body: unknown): ClientDraft | string {
  const raw = (body ?? {}) as Record<string, unknown>
  const clientCode = String(raw.clientCode ?? '').trim()
  if (!clientCode) return '商家编码不能为空'
  if (clientCode.length > 64) return '商家编码过长'
  const clientName = String(raw.clientName ?? '').trim()
  if (!clientName) return '商家名称不能为空'
  if (clientName.length > 255) return '商家名称过长'
  return { clientCode, clientName, isVip: raw.isVip === true }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

priorityClientsRouter.get('/', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.priorityClients)
      .orderBy(asc(schema.priorityClients.clientCode))
    res.json({ ok: true, data: rows satisfies PriorityClient[] })
  } catch {
    res.status(500).json({ ok: false, error: '读取优先客户列表失败' })
  }
})

priorityClientsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const draft = parseDraft(req.body)
  if (typeof draft === 'string') {
    res.status(400).json({ ok: false, error: draft })
    return
  }
  try {
    const db = getDb()
    const [row] = await db.insert(schema.priorityClients).values(draft).returning()
    res.json({ ok: true, data: row })
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ ok: false, error: `商家编码 ${draft.clientCode} 已存在` })
      return
    }
    res.status(500).json({ ok: false, error: '新增优先客户失败' })
  }
})

priorityClientsRouter.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const draft = parseDraft(req.body)
  if (typeof draft === 'string') {
    res.status(400).json({ ok: false, error: draft })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .update(schema.priorityClients)
      .set({ ...draft, updatedAt: new Date() })
      .where(eq(schema.priorityClients.id, String(req.params.id)))
      .returning()
    if (!row) {
      res.status(404).json({ ok: false, error: '优先客户不存在' })
      return
    }
    res.json({ ok: true, data: row })
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ ok: false, error: `商家编码 ${draft.clientCode} 已存在` })
      return
    }
    res.status(500).json({ ok: false, error: '更新优先客户失败' })
  }
})

priorityClientsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDb()
    const [row] = await db
      .delete(schema.priorityClients)
      .where(eq(schema.priorityClients.id, String(req.params.id)))
      .returning({ id: schema.priorityClients.id })
    if (!row) {
      res.status(404).json({ ok: false, error: '优先客户不存在' })
      return
    }
    res.json({ ok: true, data: { id: row.id } })
  } catch {
    res.status(500).json({ ok: false, error: '删除优先客户失败' })
  }
})
