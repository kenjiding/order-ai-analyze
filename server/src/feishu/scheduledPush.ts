import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import {
  generateSortEfficiencyFeishuAnalysis,
  splitFeishuWebhookTextChunks,
} from '../sortEfficiencyFeishuAnalysis'
import { getLatestFeishuPushSnapshot } from './pushSnapshotRepository'
import { claimScheduledSlot } from '../jobs/scheduledClaim'
import { fetchFeishuJson } from './feishuHttpClient'

const MAX_SNAPSHOT_AGE_DAYS = 14

/** 目标时区当天日期 YYYY-MM-DD，用于按天幂等抢占（每日一次的定时推送） */
function todayDateStrInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
}

async function postWebhookJson(
  webhookHref: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; httpStatus: number; error?: string }> {
  const result = await fetchFeishuJson(webhookHref, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!result.ok) {
    return { ok: false, httpStatus: 0, error: result.error }
  }
  const data = typeof result.json === 'object' && result.json !== null ? (result.json as Record<string, unknown>) : {}
  const ok = result.httpStatus >= 200 && result.httpStatus < 300 && typeof data.code === 'number' && data.code === 0
  return { ok, httpStatus: result.httpStatus }
}

function appendSign(payload: Record<string, unknown>, secret: string): void {
  const timestampSec = Math.floor(Date.now() / 1000)
  payload.timestamp = String(timestampSec)
  payload.sign = computeFeishuWebhookSign(secret, timestampSec)
}

export async function runScheduledFeishuPush(): Promise<void> {
  const rawUrl = process.env.FEISHU_SCHEDULE_WEBHOOK_URL?.trim()
  if (!rawUrl) {
    console.log('[scheduler/feishu] 未配置 FEISHU_SCHEDULE_WEBHOOK_URL，跳过')
    return
  }

  let webhookHref: string
  try {
    webhookHref = parseSafeWebhookUrl(rawUrl).href
  } catch {
    console.error('[scheduler/feishu] FEISHU_SCHEDULE_WEBHOOK_URL 无效，跳过')
    return
  }

  const regionCode = process.env.FEISHU_SCHEDULE_REGION_CODE?.trim() || 'global'
  const secret = process.env.FEISHU_SCHEDULE_WEBHOOK_SECRET?.trim() || undefined
  const tz = process.env.FEISHU_SCHEDULE_TIMEZONE?.trim() || 'Asia/Shanghai'

  const claimed = await claimScheduledSlot(`feishu-schedule:${regionCode}`, todayDateStrInTz(tz))
  if (!claimed) {
    console.log(`[scheduler/feishu] region=${regionCode} 今日已推送过（其他 worker 抢先处理），跳过`)
    return
  }

  const row = await getLatestFeishuPushSnapshot(regionCode)
  if (!row) {
    console.log(`[scheduler/feishu] region=${regionCode} 尚无快照，等待首次手动推送后再触发`)
    return
  }

  const ageDays = (Date.now() - row.pushedAt.getTime()) / 86_400_000
  if (ageDays > MAX_SNAPSHOT_AGE_DAYS) {
    console.warn(`[scheduler/feishu] 快照已 ${ageDays.toFixed(1)} 天未更新（>${MAX_SNAPSHOT_AGE_DAYS}天），跳过本次推送`)
    return
  }

  const gen = await generateSortEfficiencyFeishuAnalysis(row.snapshot)
  if (!gen.ok) {
    console.error(`[scheduler/feishu] AI 生成失败: ${gen.error}（reason=${gen.reason}）`)
    return
  }

  const chunks = splitFeishuWebhookTextChunks(gen.text)
  for (const chunk of chunks) {
    const text = chunk.trim()
    if (!text) continue
    const payload: Record<string, unknown> = { msg_type: 'text', content: { text } }
    if (secret) appendSign(payload, secret)
    const result = await postWebhookJson(webhookHref, payload)
    if (!result.ok) {
      console.error(`[scheduler/feishu] 飞书返回失败：${result.error ?? `HTTP ${result.httpStatus}`}`)
      return
    }
  }

  console.log(`[scheduler/feishu] 推送成功 region=${regionCode} period="${row.periodLabel}"`)
}
