/**
 * 假期/临时开仓日历的例外表管理：按州(regionCode)维护出仓/派送日历的例外日期，
 * 供出仓派签达成分析（dispatch24hStats）等功能结算时查表（见 imile/sortingWorkday.ts 的
 * RegionCalendarOverrides）。菜单本身按用户要求默认全员开放（见 permissions/registry.ts 的
 * DEFAULT_GRANTED_PERMISSION_KEYS），这里只做常规登录校验，不额外挂按钮级权限。
 */
import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import type { RegionCalendarOverride } from '../db/schema'
import {
  deleteRegionCalendarOverride,
  listRegionCalendarOverrides,
  upsertRegionCalendarOverride,
} from '../dispatch24hStats/configRepository'
import { isAssignableRegionCode } from '../regions/registry'

export const regionCalendarOverrideRouter = Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 正则只管形状，"2026-02-30" 这种格式对但日历上不存在的日期会漏过去——JS Date 会把它
 * 静默归一化成 03-02，之后所有按这个假期算的顺延/结算都会悄悄错位。这里用往返校验兜底：
 * 构造出来的日期各字段必须跟输入完全一致，归一化过的日期做不到这一点。
 */
function isValidCalendarDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(y, m - 1, d))
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
}

type OverrideDraft = {
  regionCode: string
  date: string
  isExitDay: boolean | null
  isDispatchDay: boolean | null
  note: string
}

/** 解析请求体；返回字符串表示校验失败原因 */
function parseDraft(body: unknown): OverrideDraft | string {
  const raw = (body ?? {}) as Record<string, unknown>
  const regionCode = String(raw.regionCode ?? '').trim()
  if (!regionCode) return '请选择州'
  if (!isAssignableRegionCode(regionCode)) return '无效的州编码'
  const date = String(raw.date ?? '').trim()
  if (!DATE_RE.test(date) || !isValidCalendarDate(date)) return '日期格式应为 YYYY-MM-DD，且必须是真实存在的日期'
  const parseTri = (value: unknown): boolean | null | string => {
    if (value === null || value === undefined || value === '') return null
    if (value === true || value === false) return value
    return '非法的开关取值'
  }
  const isExitDay = parseTri(raw.isExitDay)
  if (typeof isExitDay === 'string') return isExitDay
  const isDispatchDay = parseTri(raw.isDispatchDay)
  if (typeof isDispatchDay === 'string') return isDispatchDay
  const note = String(raw.note ?? '').trim()
  if (note.length > 255) return '备注过长'
  return { regionCode, date, isExitDay, isDispatchDay, note }
}

/** 某州的全部例外日期，按日期升序 */
regionCalendarOverrideRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const regionCode = String(req.query.regionCode ?? '').trim()
  if (!regionCode) {
    res.status(400).json({ ok: false, error: '请提供 regionCode' })
    return
  }
  try {
    const rows = await listRegionCalendarOverrides(regionCode)
    res.json({ ok: true, data: rows satisfies RegionCalendarOverride[] })
  } catch {
    res.status(500).json({ ok: false, error: '读取假期日历失败' })
  }
})

/** 新增/修改某天的例外，按 (regionCode, date) upsert */
regionCalendarOverrideRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const draft = parseDraft(req.body)
  if (typeof draft === 'string') {
    res.status(400).json({ ok: false, error: draft })
    return
  }
  try {
    const row = await upsertRegionCalendarOverride({ ...draft, userId: req.authUser?.id ?? null })
    res.json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '保存假期日历失败' })
  }
})

regionCalendarOverrideRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const removed = await deleteRegionCalendarOverride(String(req.params.id))
    if (!removed) {
      res.status(404).json({ ok: false, error: '记录不存在' })
      return
    }
    res.json({ ok: true, data: { id: req.params.id } })
  } catch {
    res.status(500).json({ ok: false, error: '删除失败' })
  }
})
