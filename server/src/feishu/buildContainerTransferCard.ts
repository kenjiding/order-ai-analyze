/**
 * 容器流转变更通知卡片（飞书 card JSON 2.0）。
 *
 * 一笔流转私聊逐人发送，所以卡片按收件人在这笔流转里的身份差异化：
 * 待接收方确认时只有接收方那边的人看到「去确认收货」，协商中转出方看到「去处理协商」。
 * 按钮不在卡片里改库存，只深链回系统对应页面并自动定位到这一笔，实际操作仍走系统内的权限校验。
 */
import {
  containerTypeLabel,
  formatTransferNo,
  transferKindLabel,
  transferStatusLabel,
  type ContainerType,
  type TransferKind,
  type TransferStatus,
} from '../containerManagement/constants'
import type { TransferSide } from '../containerManagement/transferNotify'
import type { TransferView } from '../containerManagement/transferService'
import { buildContainerTransferUrl } from './publicWebOrigin'

type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue' | 'purple'

/** 磁贴柔和背景：用色板 -50 浅色阶，与出仓告警卡片保持同一套观感 */
const TILE_BG: Record<MarkColor, string> = {
  red: 'red-50',
  orange: 'orange-50',
  green: 'green-50',
  grey: 'grey-50',
  blue: 'blue-50',
  purple: 'purple-50',
}

/**
 * 只推「对方需要知道或需要做点什么」的节点：开始、有争议、以及两条路径各自的结清。
 * 编辑与删除是转出方自己的动作，不推。
 */
export type TransferCardEvent = 'created' | 'reported' | 'confirmed' | 'accepted'

/** 事件 → 卡片标题与头部配色，与系统内时间线的状态色语言对齐 */
const EVENT_STYLE: Record<TransferCardEvent, { title: string; template: string }> = {
  created: { title: '新建流转', template: 'blue' },
  reported: { title: '接收方申报了差异', template: 'orange' },
  // 无争议直接确认、协商后转出方认可，是两条路径各自的结清，同用绿色
  confirmed: { title: '接收方已确认收货', template: 'green' },
  accepted: { title: '转出方已认可实收数量', template: 'green' },
}

/**
 * 认可的实收全为 0 时整单取消，等于转出方接受了全部拒收。
 * 这时候还挂绿色的「已认可实收数量」会读成好消息，按取消如实呈现。
 */
function resolveStyle(
  event: TransferCardEvent,
  status: string,
): { title: string; template: string } {
  if (event === 'accepted' && status === 'CANCELLED') {
    return { title: '转出方已认可全部拒收，本单取消', template: 'grey' }
  }
  return EVENT_STYLE[event]
}

function md(content: string, extra?: CardEl): CardEl {
  return { tag: 'markdown', content, ...extra }
}

function hr(): CardEl {
  return { tag: 'hr' }
}

/** JSON 2.0 没有 note 组件，页脚说明用小号灰字 markdown */
function footerCaption(content: string): CardEl {
  return md(colored(content, 'grey'), { text_size: 'notation' })
}

function colored(value: string, color: MarkColor): string {
  return `<font color='${color}'>${value}</font>`
}

function labelOf(containerType: string): string {
  return containerTypeLabel[containerType as ContainerType] ?? containerType
}

/** 三格指标磁贴，与系统内协商抽屉的「转出方发出 / 接收方实收 / 已入账」一一对应 */
function metricTile(
  label: string,
  total: number | null,
  breakdown: string,
  color: MarkColor,
): CardEl {
  const value = total === null ? '-' : String(total)
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: total === null ? TILE_BG.grey : TILE_BG[color],
    padding: '8px 10px 8px 10px',
    elements: [
      md(
        [
          colored(label, 'grey'),
          colored(`**${value}**`, total === null ? 'grey' : color),
          colored(breakdown || '-', 'grey'),
        ].join('\n'),
      ),
    ],
  }
}

function breakdownOf(
  items: TransferView['items'],
  field: 'declaredQuantity' | 'receivedQuantity' | 'settledQuantity',
): string {
  const parts = items
    .map((item) => ({ label: labelOf(item.containerType), value: item[field] }))
    .filter((item): item is { label: string; value: number } => item.value !== null)
    .map((item) => `${item.label} ${item.value}`)
  return parts.join(' · ')
}

/**
 * 按钮同时挂 open_url（点了直接跳系统）+ callback（服务端拿到点击人，落到推送数据监控）。
 * 与工单推送卡片同一套做法。
 */
function linkButton(
  url: string,
  label: string,
  style: 'primary_filled' | 'default',
  value: Record<string, unknown>,
): CardEl {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type: style,
    width: 'default',
    size: 'medium',
    behaviors: [
      { type: 'open_url', default_url: url, pc_url: url, ios_url: url, android_url: url },
      { type: 'callback', value },
    ],
  }
}

/** 收件人身份 + 当前状态 → 他该被引导去做的那件事 */
function primaryAction(
  transfer: TransferView,
  sides: TransferSide[],
): { label: string; action: 'confirm' | 'negotiate' | 'timeline'; actionType: string } {
  const isReceiver = sides.includes('to')
  const isSender = sides.includes('from')
  const status = transfer.status as TransferStatus

  if (status === 'PENDING_RECEIVER' && isReceiver) {
    return { label: '去确认收货', action: 'confirm', actionType: 'goto_confirm' }
  }
  if (status === 'DISPUTED' && isSender) {
    return { label: '去处理协商', action: 'negotiate', actionType: 'goto_negotiate' }
  }
  if (status === 'DISPUTED' && isReceiver) {
    return { label: '去修改申报', action: 'negotiate', actionType: 'goto_negotiate' }
  }
  return { label: '查看流转详情', action: 'timeline', actionType: 'goto_detail' }
}

export function buildContainerTransferCard(params: {
  transfer: TransferView
  event: TransferCardEvent
  actorName: string
  /** 事件附带的正文：创建备注、申报原因、收货备注 */
  extra?: string | null
  /** 收件人在这笔流转里的身份，决定给哪个按钮 */
  sides: TransferSide[]
}): Record<string, unknown> {
  const { transfer, event, actorName, extra, sides } = params
  const style = resolveStyle(event, transfer.status)
  const elements: CardEl[] = []

  const kindLabel = transferKindLabel[transfer.kind as TransferKind] ?? transfer.kind
  elements.push(
    md(
      `**${transfer.fromAccountName}** → **${transfer.toAccountName}**　${colored(kindLabel, 'grey')}`,
    ),
  )

  elements.push({
    tag: 'column_set',
    flex_mode: 'trisect',
    background_style: 'default',
    horizontal_spacing: 'small',
    columns: [
      metricTile('转出方发出', transfer.declaredTotal, breakdownOf(transfer.items, 'declaredQuantity'), 'blue'),
      metricTile('接收方实收', transfer.receivedTotal, breakdownOf(transfer.items, 'receivedQuantity'), 'orange'),
      metricTile('已入账', transfer.settledTotal, breakdownOf(transfer.items, 'settledQuantity'), 'green'),
    ],
  })

  if (extra?.trim()) {
    elements.push(md(extra.trim()))
  }

  const action = primaryAction(transfer, sides)
  const url = buildContainerTransferUrl(transfer.id, action.action)
  if (url) {
    elements.push(hr())
    elements.push(
      linkButton(url, action.label, 'primary_filled', {
        pushType: 'container_transfer',
        actionType: action.actionType,
        transferId: String(transfer.id),
      }),
    )
  }

  const statusLine = transferStatusLabel[transfer.status as TransferStatus] ?? transfer.status
  elements.push(
    footerCaption(
      `${formatTransferNo(transfer.id)} · ${statusLine} · 操作人 ${actorName || '未知用户'} · 容器管理`,
    ),
  )

  return {
    schema: '2.0',
    header: {
      template: style.template,
      title: { tag: 'plain_text', content: `容器流转 · ${style.title}` },
      subtitle: { tag: 'plain_text', content: formatTransferNo(transfer.id) },
    },
    body: { direction: 'vertical', elements },
  }
}
