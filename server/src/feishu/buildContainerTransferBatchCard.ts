/**
 * 容器流转「批量新建」汇总卡片（飞书 card JSON 2.0）。
 *
 * 一次导入/多组提交可能产生上百笔，逐笔推会把接收方私聊刷屏，所以按收件人归并成一条：
 * 每个人只收到与他相关的那些流转，且按「待他确认 / 转入已入账 / 他方转出」分块，
 * 只有第一块需要他行动，按钮深链到流转列表并预置筛选，不定位到具体某一笔。
 *
 * 单笔卡片见 buildContainerTransferCard；那张有实收/已入账磁贴，批量新建时这两格恒为空，
 * 所以这里不复用，改为按站点线路聚合的明细行。
 */
import {
  containerTypeLabel,
  formatTransferNo,
  type ContainerType,
  type TransferStatus,
} from '../containerManagement/constants'
import type { TransferSide } from '../containerManagement/transferNotify'
import type { TransferView } from '../containerManagement/transferService'
import { buildContainerTransferListUrl } from './publicWebOrigin'

type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue' | 'purple'

/** 线路汇总行超过这个数就折叠成「等共 N 条线路」，避免卡片被几十条线路撑爆 */
const MAX_ROUTE_ROWS = 8

/** 逐笔明细最多列这么多；导入上限 200 笔，全列会把卡片撑成一面墙 */
const MAX_DETAIL_ROWS = 10

/** 一笔流转 + 收件人在其中的身份 */
export type TransferBatchEntry = {
  transfer: TransferView
  sides: TransferSide[]
}

/** 收件人在一笔流转里的落位，决定它进汇总的哪一块、明细行挂什么标签 */
type Bucket = 'pending' | 'incoming' | 'outgoing'

/** 同一条站点线路上的多笔流转合并成一行 */
type RouteRow = {
  key: string
  label: string
  count: number
  /** 容器品类 → 申报数量合计 */
  quantities: Map<string, number>
}

type Section = {
  title: string
  color: MarkColor
  rows: RouteRow[]
  count: number
}

function md(content: string, extra?: CardEl): CardEl {
  return { tag: 'markdown', content, ...extra }
}

function hr(): CardEl {
  return { tag: 'hr' }
}

function colored(value: string, color: MarkColor): string {
  return `<font color='${color}'>${value}</font>`
}

function footerCaption(content: string): CardEl {
  return md(colored(content, 'grey'), { text_size: 'notation' })
}

function labelOf(containerType: string): string {
  return containerTypeLabel[containerType as ContainerType] ?? containerType
}

/**
 * 收件人在这笔流转里的落位：
 * 同时是双方联系人时算「待确认/转入」，因为需要他行动的那一面优先。
 */
function bucketOf(entry: TransferBatchEntry): Bucket {
  if (entry.sides.includes('to')) {
    return (entry.transfer.status as TransferStatus) === 'PENDING_RECEIVER' ? 'pending' : 'incoming'
  }
  return 'outgoing'
}

/** 明细行混排三类流转，所以每行要自带身份标签 */
const DETAIL_TAG: Record<Bucket, { label: string; color: MarkColor }> = {
  pending: { label: '待确认', color: 'orange' },
  incoming: { label: '已入账', color: 'green' },
  outgoing: { label: '转出', color: 'blue' },
}

function quantityText(items: TransferView['items']): string {
  return items
    .map((item) => `${labelOf(item.containerType)} ${item.declaredQuantity}`)
    .join(' · ')
}

/**
 * 汇总之后的逐笔明细，按「待确认 → 已入账 → 转出」排，同类内按编号升序。
 * 超出 MAX_DETAIL_ROWS 只列前几笔，其余靠上面的汇总和按钮进系统看。
 */
function renderDetails(entries: TransferBatchEntry[]): CardEl[] {
  const order: Bucket[] = ['pending', 'incoming', 'outgoing']
  const sorted = [...entries].sort((a, b) => {
    const diff = order.indexOf(bucketOf(a)) - order.indexOf(bucketOf(b))
    return diff !== 0 ? diff : a.transfer.id - b.transfer.id
  })
  const shown = sorted.slice(0, MAX_DETAIL_ROWS)

  const elements: CardEl[] = [
    md(
      shown.length < sorted.length
        ? `${colored('逐笔明细', 'grey')}\u3000${colored(`仅列前 ${shown.length} 笔，共 ${sorted.length} 笔`, 'grey')}`
        : colored('逐笔明细', 'grey'),
    ),
  ]
  for (const entry of shown) {
    const tag = DETAIL_TAG[bucketOf(entry)]
    const { transfer } = entry
    elements.push(
      md(
        [
          colored(tag.label, tag.color),
          formatTransferNo(transfer.id),
          `**${transfer.fromAccountName}** → **${transfer.toAccountName}**`,
          colored(quantityText(transfer.items) || '-', 'grey'),
        ].join('\u3000'),
      ),
    )
  }
  return elements
}

function toRouteRows(entries: TransferBatchEntry[]): RouteRow[] {
  const byRoute = new Map<string, RouteRow>()
  for (const { transfer } of entries) {
    const key = `${transfer.fromAccountId}→${transfer.toAccountId}`
    let row = byRoute.get(key)
    if (!row) {
      row = {
        key,
        label: `**${transfer.fromAccountName}** → **${transfer.toAccountName}**`,
        count: 0,
        quantities: new Map(),
      }
      byRoute.set(key, row)
    }
    row.count += 1
    for (const item of transfer.items) {
      const label = labelOf(item.containerType)
      row.quantities.set(label, (row.quantities.get(label) ?? 0) + item.declaredQuantity)
    }
  }
  // 笔数多的线路排前面，截断时留下的是最值得看的
  return [...byRoute.values()].sort((a, b) => b.count - a.count)
}

function renderSection(section: Section): CardEl[] {
  const elements: CardEl[] = [
    md(`${colored(section.title, section.color)}\u3000**${section.count}** 笔`),
  ]
  const shown = section.rows.slice(0, MAX_ROUTE_ROWS)
  for (const row of shown) {
    const breakdown = [...row.quantities.entries()]
      .map(([label, value]) => `${label} ${value}`)
      .join(' · ')
    elements.push(
      md(`${row.label}\u3000${colored(`${row.count} 笔`, 'grey')}\u3000${colored(breakdown || '-', 'grey')}`),
    )
  }
  if (section.rows.length > shown.length) {
    elements.push(footerCaption(`…等共 ${section.rows.length} 条线路`))
  }
  return elements
}

/**
 * @param entries 与该收件人相关的流转，已带上他在每一笔里的身份
 * @param actorName 提交人，页脚署名
 */
export function buildContainerTransferBatchCard(params: {
  entries: TransferBatchEntry[]
  actorName: string
}): Record<string, unknown> {
  const { entries, actorName } = params

  const pending = entries.filter((entry) => bucketOf(entry) === 'pending')
  const incoming = entries.filter((entry) => bucketOf(entry) === 'incoming')
  const outgoing = entries.filter((entry) => bucketOf(entry) === 'outgoing')

  const sections: Section[] = []
  if (pending.length > 0) {
    sections.push({
      title: '待你确认收货',
      color: 'orange',
      rows: toRouteRows(pending),
      count: pending.length,
    })
  }
  if (incoming.length > 0) {
    sections.push({
      title: '转入已入账',
      color: 'green',
      rows: toRouteRows(incoming),
      count: incoming.length,
    })
  }
  if (outgoing.length > 0) {
    sections.push({
      title: '你方转出',
      color: 'blue',
      rows: toRouteRows(outgoing),
      count: outgoing.length,
    })
  }

  const elements: CardEl[] = []
  sections.forEach((section, index) => {
    if (index > 0) elements.push(hr())
    elements.push(...renderSection(section))
  })

  elements.push(hr())
  elements.push(...renderDetails(entries))

  // 待确认的线路只涉及一个接收站点时把它带进筛选，多个站点则只按状态筛，让他一屏看全
  const pendingToAccountIds = new Set(pending.map((entry) => entry.transfer.toAccountId))
  const url =
    pending.length > 0
      ? buildContainerTransferListUrl({
          status: 'PENDING_RECEIVER',
          toAccountId: pendingToAccountIds.size === 1 ? [...pendingToAccountIds][0] : undefined,
        })
      : buildContainerTransferListUrl({})
  if (url) {
    const label = pending.length > 0 ? '去确认收货' : '查看流转记录'
    elements.push(hr())
    elements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: label },
      type: 'primary_filled',
      width: 'default',
      size: 'medium',
      behaviors: [
        { type: 'open_url', default_url: url, pc_url: url, ios_url: url, android_url: url },
        {
          type: 'callback',
          value: {
            pushType: 'container_transfer_batch',
            actionType: pending.length > 0 ? 'goto_confirm_list' : 'goto_list',
            count: String(entries.length),
          },
        },
      ],
    })
  }

  elements.push(footerCaption(`提交人 ${actorName || '未知用户'} · 容器管理`))

  return {
    schema: '2.0',
    header: {
      // 有待确认的才是需要他动手的，用橙色区分于纯知会
      template: pending.length > 0 ? 'orange' : 'blue',
      title: { tag: 'plain_text', content: `容器流转 · 批量新建 ${entries.length} 笔` },
      subtitle: {
        tag: 'plain_text',
        content: pending.length > 0 ? `其中 ${pending.length} 笔待你确认收货` : '知会，无需确认',
      },
    },
    body: { direction: 'vertical', elements },
  }
}
