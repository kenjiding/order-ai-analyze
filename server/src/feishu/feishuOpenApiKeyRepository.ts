import crypto from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { feishuOpenApiKeys } from '../db/schema'
import type { FeishuOpenApiKey } from '../db/schema'

export async function createFeishuOpenApiKey(name: string, createdBy?: string | null): Promise<FeishuOpenApiKey> {
  const db = getDb()
  const token = crypto.randomBytes(32).toString('hex')
  const [row] = await db
    .insert(feishuOpenApiKeys)
    .values({ name, token, createdBy: createdBy ?? null })
    .returning()
  return row!
}

/** 鉴权查询：仅返回未禁用的 key；禁用或不存在都视为无效 */
export async function findActiveFeishuOpenApiKeyByToken(token: string): Promise<FeishuOpenApiKey | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(feishuOpenApiKeys)
    .where(eq(feishuOpenApiKeys.token, token))
    .limit(1)
  return row && !row.isDisabled ? row : null
}

export async function listFeishuOpenApiKeys(): Promise<FeishuOpenApiKey[]> {
  const db = getDb()
  return db.select().from(feishuOpenApiKeys).orderBy(desc(feishuOpenApiKeys.createdAt))
}

export async function setFeishuOpenApiKeyDisabled(id: string, isDisabled: boolean): Promise<FeishuOpenApiKey | null> {
  const db = getDb()
  const [row] = await db.update(feishuOpenApiKeys).set({ isDisabled }).where(eq(feishuOpenApiKeys.id, id)).returning()
  return row ?? null
}

export async function deleteFeishuOpenApiKey(id: string): Promise<boolean> {
  const db = getDb()
  const [row] = await db.delete(feishuOpenApiKeys).where(eq(feishuOpenApiKeys.id, id)).returning({ id: feishuOpenApiKeys.id })
  return Boolean(row)
}

/** 鉴权通过后记一次使用时间，供排查/判断 key 是否还在用；失败不影响本次请求 */
export async function touchFeishuOpenApiKeyLastUsed(id: string): Promise<void> {
  try {
    const db = getDb()
    await db.update(feishuOpenApiKeys).set({ lastUsedAt: new Date() }).where(eq(feishuOpenApiKeys.id, id))
  } catch (err) {
    console.error('[feishu-open-api-key] 更新 lastUsedAt 失败（不影响本次请求）:', err)
  }
}
