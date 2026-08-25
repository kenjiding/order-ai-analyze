import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import { sendFeishuAppMessage } from '../feishu/feishuAppMessage'
import {
  parseSupplierMentionContacts,
  type SupplierMentionContact,
} from '../feishu/feishuMentionHelpers'
import { claimScheduledSlot } from '../jobs/scheduledClaim'
import { readImileTokenCheckTimeZone } from '../jobs/config'
import { fetchVendorStations } from './vendorAnalysis'
import { isImileTokenExpiredFailure } from './shared'

const APP_SETTINGS_PREF_KEY = 'app-settings'

type TokenAlertContacts = {
  chatId: string
  mentions: SupplierMentionContact[]
}

type CheckTarget = {
  userId: string
  displayName: string
  imileToken: string
  contacts: TokenAlertContacts
}

/** 解析 app-settings 里的「token 失效联系人」配置 */
function parseTokenAlertContacts(raw: unknown): TokenAlertContacts {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    chatId: typeof obj.chatId === 'string' ? obj.chatId.trim() : '',
    mentions: parseSupplierMentionContacts(obj.mentions),
  }
}

/** 配置时区下的当前日期与时刻，用于按「日期+时刻」幂等抢占 */
function nowInCheckTimeZone(): { dateStr: string; timeHHmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: readImileTokenCheckTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    timeHHmm: `${get('hour')}:${get('minute')}`,
  }
}

/** 读取所有配置了 iMile token 的启用账号 */
async function loadCheckTargets(): Promise<CheckTarget[]> {
  const db = getDb()
  const rows = await db
    .select({
      userId: schema.userPreferences.userId,
      value: schema.userPreferences.value,
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.userPreferences)
    .innerJoin(schema.users, eq(schema.users.id, schema.userPreferences.userId))
    .where(
      and(
        eq(schema.userPreferences.prefKey, APP_SETTINGS_PREF_KEY),
        eq(schema.users.isActive, true),
      ),
    )

  const targets: CheckTarget[] = []
  for (const row of rows) {
    const settings = row.value && typeof row.value === 'object' ? (row.value as Record<string, unknown>) : {}
    const imileToken = typeof settings.imileToken === 'string' ? settings.imileToken.trim() : ''
    if (!imileToken) continue
    targets.push({
      userId: row.userId,
      displayName: row.displayName?.trim() || row.username,
      imileToken,
      contacts: parseTokenAlertContacts(settings.tokenAlertContacts),
    })
  }
  return targets
}

/**
 * iMile 的失效报错会把 token 原样回显（如 `Invalid access token: <uuid>`）。
 * 告警要发到飞书，先把凭据抹掉，避免明文外传。
 */
function redactToken(message: string): string {
  return message.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '***')
}

/** 探活：调最轻量的只读接口，判断 token 是否已失效 */
async function probeTokenExpired(token: string): Promise<{ expired: boolean; detail: string }> {
  const result = await fetchVendorStations(token)
  if (result.ok) return { expired: false, detail: '' }

  const failure = result.businessFailure
  if (failure && isImileTokenExpiredFailure(failure)) {
    return { expired: true, detail: `${failure.code} ${redactToken(failure.message)}` }
  }
  // 其它失败（网络/超时/系统繁忙）不当作 token 失效，避免误报
  console.warn(`[imile-token-check] 探活失败但非 token 失效，跳过告警：${redactToken(result.message)}`)
  return { expired: false, detail: redactToken(result.message) }
}

function buildAlertText(displayName: string, detail: string, timeHHmm: string): string {
  return [
    '【iMile Token 失效提醒】',
    `账号：${displayName}`,
    `检测时间：${timeHHmm}（${readImileTokenCheckTimeZone()}）`,
    `接口返回：${detail}`,
    '',
    '受影响：出仓告警、催派推送、工单推送、供应商日报等所有依赖该 token 的定时任务已无法取数。',
    '请到系统设置 → iMile 接口，重新粘贴 Bearer Token。',
  ].join('\n')
}

/** 私聊通知配置的每一位联系人；返回成功条数 */
async function notifyTokenAlertContacts(
  contacts: TokenAlertContacts,
  displayName: string,
  text: string,
): Promise<number> {
  const mentions = contacts.mentions.filter((m) => m.openId)
  if (!mentions.length) {
    console.warn(`[imile-token-check] 账号 ${displayName} 未配置 token 失效联系人，无法通知`)
    return 0
  }

  const tokenResult = await getFeishuTenantAccessToken()
  if (!tokenResult.ok) {
    console.error(`[imile-token-check] 获取飞书 tenant token 失败：${tokenResult.reason}`)
    return 0
  }

  let sent = 0
  for (const contact of mentions) {
    const res = await sendFeishuAppMessage(
      tokenResult.token,
      contact.openId,
      'text',
      { text },
      'open_id',
    )
    if (res.ok) {
      sent += 1
    } else {
      console.error(`[imile-token-check] 私聊 ${contact.name || contact.openId} 失败：${res.error}`)
    }
  }
  return sent
}

/**
 * 由 cron 按 IMILE_TOKEN_CHECK_CRON 配置的时刻触发：逐个账号探活，失效则私聊其配置的联系人。
 * 同一账号同一时刻靠 claim 保证多 worker 下只发一次。
 */
export async function runImileTokenHealthCheck(): Promise<void> {
  let targets: CheckTarget[]
  try {
    targets = await loadCheckTargets()
  } catch (err) {
    console.error('[imile-token-check] 读取待检测账号失败:', err)
    return
  }

  const { dateStr, timeHHmm } = nowInCheckTimeZone()

  for (const target of targets) {
    const claimed = await claimScheduledSlot(`imile-token-check:${target.userId}`, `${dateStr}|${timeHHmm}`)
    if (!claimed) continue

    try {
      const probe = await probeTokenExpired(target.imileToken)
      if (!probe.expired) {
        console.log(`[imile-token-check] ${target.displayName} ${timeHHmm} token 正常`)
        continue
      }
      const sent = await notifyTokenAlertContacts(
        target.contacts,
        target.displayName,
        buildAlertText(target.displayName, probe.detail, timeHHmm),
      )
      console.warn(
        `[imile-token-check] ${target.displayName} token 已失效（${probe.detail}），已私聊通知 ${sent} 人`,
      )
    } catch (err) {
      console.error(`[imile-token-check] ${target.displayName} 检测异常:`, err)
    }
  }
}
