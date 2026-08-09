import type { PushClickEvent, PushEngagementRow, PushReadStatus, PushReadStatusUser } from './pushEngagementTypes'

export type DateGroup = {
  date: string
  rows: PushEngagementRow[]
  messageCount: number
  clicksByAction: Record<string, number>
  labels: string[]
}

export type LabelGroup = {
  pushLabel: string
  rows: PushEngagementRow[]
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function groupKey(date: string, pushLabel: string): string {
  return `${date}::${pushLabel}`
}

export function groupRowsByDate(rows: PushEngagementRow[]): DateGroup[] {
  const map = new Map<string, PushEngagementRow[]>()
  for (const row of rows) {
    const key = formatDateKey(row.createdAt)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row)
  }
  return [...map.entries()]
    .map(([date, groupRows]) => {
      const clicksByAction: Record<string, number> = {}
      for (const row of groupRows) {
        for (const [action, n] of Object.entries(row.clicks)) {
          clicksByAction[action] = (clicksByAction[action] ?? 0) + n
        }
      }
      return {
        date,
        rows: groupRows,
        messageCount: groupRows.length,
        clicksByAction,
        labels: [...new Set(groupRows.map((r) => r.pushLabel ?? '未标记'))],
      }
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function groupRowsByLabel(rows: PushEngagementRow[]): LabelGroup[] {
  const map = new Map<string, PushEngagementRow[]>()
  for (const row of rows) {
    const key = row.pushLabel ?? '未标记'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row)
  }
  return [...map.entries()].map(([pushLabel, groupRows]) => ({ pushLabel, rows: groupRows }))
}

/** 合并同一(日期+推送类型)下多条消息的已读名单：按 userId 去重，读过任意一条即算已读 */
export function mergeReadStatuses(list: PushReadStatus[]): PushReadStatus {
  const readMap = new Map<string, PushReadStatusUser>()
  const seenMap = new Map<string, PushReadStatusUser>()
  for (const item of list) {
    for (const u of item.readUsers) {
      readMap.set(u.userId, u)
      seenMap.set(u.userId, u)
    }
    for (const u of item.unreadUsers) {
      if (!seenMap.has(u.userId)) seenMap.set(u.userId, u)
    }
  }
  const readUsers = [...readMap.values()]
  const unreadUsers = [...seenMap.values()].filter((u) => !readMap.has(u.userId))
  return {
    messageId: 'aggregated',
    sentAt: list[0]?.sentAt ?? '',
    totalMembers: seenMap.size,
    readCount: readUsers.length,
    readUsers,
    unreadUsers,
  }
}

export type DedupedClickUser = { openId: string; name: string; count: number; lastClickedAt: string }

/** 同一用户在同一 actionType 下的多次点击去重合并，例如"用户A"点击 3 次 → { count: 3 } */
export function dedupeClickEvents(events: PushClickEvent[]): DedupedClickUser[] {
  const map = new Map<string, DedupedClickUser>()
  for (const e of events) {
    const existing = map.get(e.openId)
    if (existing) {
      existing.count += 1
      if (e.clickedAt > existing.lastClickedAt) existing.lastClickedAt = e.clickedAt
    } else {
      map.set(e.openId, { openId: e.openId, name: e.name, count: 1, lastClickedAt: e.clickedAt })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}
