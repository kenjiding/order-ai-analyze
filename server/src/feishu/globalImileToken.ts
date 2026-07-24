import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'

const APP_SETTINGS_PREF_KEY = 'app-settings'

/**
 * 「系统设置」里保存的全局 iMile token（user_preferences.app-settings.imileToken）。
 * 各定时推送优先使用该值而非各自 schedule 行里的历史快照，避免用户改了全局 token
 * 后，定时任务/立即推送仍沿用保存 schedule 那一刻同步进去的旧值。
 */
export async function getGlobalImileToken(userId: string): Promise<string> {
  try {
    const db = getDb()
    const [row] = await db
      .select({ value: schema.userPreferences.value })
      .from(schema.userPreferences)
      .where(and(eq(schema.userPreferences.userId, userId), eq(schema.userPreferences.prefKey, APP_SETTINGS_PREF_KEY)))
      .limit(1)
    const raw = row?.value as { imileToken?: unknown } | undefined
    return typeof raw?.imileToken === 'string' ? raw.imileToken.trim() : ''
  } catch (err) {
    // 查询失败不应阻断 token 解析：让调用方退回 schedule 快照/环境变量兜底
    console.error('[globalImileToken] 读取全局 iMile token 失败，退回 schedule 快照兜底:', err)
    return ''
  }
}
