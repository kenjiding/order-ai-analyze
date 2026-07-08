import { and, eq } from 'drizzle-orm'
import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb } from '../db'
import { userPreferences } from '../db/schema'

export const userPreferencesRouter = Router()

const PREF_KEY_PATTERN = /^[a-z0-9][a-z0-9.-]{0,127}$/
/** value 为任意 jsonb，限制体积防止滥用为通用存储 */
const MAX_VALUE_BYTES = 16 * 1024

function parsePrefKey(raw: string): string | null {
  const key = raw.trim()
  return PREF_KEY_PATTERN.test(key) ? key : null
}

/** 读取当前用户某个偏好；从未保存过返回 value: null */
userPreferencesRouter.get('/:prefKey', async (req: AuthenticatedRequest, res: Response) => {
  const prefKey = parsePrefKey(String(req.params.prefKey ?? ''))
  if (!prefKey) {
    res.status(404).json({ ok: false, error: '无效的偏好 key' })
    return
  }
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .select({ value: userPreferences.value, updatedAt: userPreferences.updatedAt })
      .from(userPreferences)
      .where(and(eq(userPreferences.userId, userId), eq(userPreferences.prefKey, prefKey)))
      .limit(1)
    res.json({ ok: true, data: { value: row?.value ?? null, updatedAt: row?.updatedAt?.toISOString() ?? null } })
  } catch {
    res.status(500).json({ ok: false, error: '读取用户偏好失败' })
  }
})

/** 保存当前用户某个偏好（upsert 整个 value） */
userPreferencesRouter.put('/:prefKey', async (req: AuthenticatedRequest, res: Response) => {
  const prefKey = parsePrefKey(String(req.params.prefKey ?? ''))
  if (!prefKey) {
    res.status(404).json({ ok: false, error: '无效的偏好 key' })
    return
  }
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const { value } = req.body as { value?: unknown }
  if (value === undefined) {
    res.status(400).json({ ok: false, error: '缺少 value' })
    return
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_VALUE_BYTES) {
    res.status(400).json({ ok: false, error: 'value 超过 16KB 限制' })
    return
  }
  try {
    const db = getDb()
    const now = new Date()
    const [row] = await db
      .insert(userPreferences)
      .values({ userId, prefKey, value, updatedAt: now })
      .onConflictDoUpdate({
        target: [userPreferences.userId, userPreferences.prefKey],
        set: { value, updatedAt: now },
      })
      .returning({ value: userPreferences.value, updatedAt: userPreferences.updatedAt })
    res.json({ ok: true, data: { value: row?.value ?? value, updatedAt: row?.updatedAt?.toISOString() ?? now.toISOString() } })
  } catch {
    res.status(500).json({ ok: false, error: '保存用户偏好失败' })
  }
})
