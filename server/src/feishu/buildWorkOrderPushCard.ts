import { iMileStrToMs, localDateTimeInTz, tzDisplayName, type AusTz } from '../imile/ausTimezone'
import type { WorkOrderPushVendorSummary } from '../vendorAnalysis/workOrderPushAggregate'
import { buildMentionLarkMd, type SupplierMentionContact } from './feishuMentionHelpers'

type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue'

const MAX_TICKET_LINES = 15

function div(content: string): CardEl {
  return { tag: 'div', text: { tag: 'lark_md', content } }
}

function hr(): CardEl {
  return { tag: 'hr' }
}

function note(content: string): CardEl {
  return { tag: 'note', elements: [{ tag: 'lark_md', content }] }
}

function colored(value: string, color: MarkColor): string {
  return `<font color='${color}'>${value}</font>`
}

const PCS_TICKET_WORKBENCH_URL = 'https://pcs.imile.com/#/PCSTicketWorkbench'

/** 自定义机器人 v1 卡片：用 action + button.url 打开 PCS 工单工作台（markdown 链接不可跳转） */
function openUrlAction(url: string, label: string): CardEl {
  return {
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: label },
        type: 'primary',
        url,
      },
    ],
  }
}

const TYPE_LABEL: Record<string, string> = {
  normal: 'Normal Ticket',
  complaint: 'Complaint Ticket',
  arbitration: 'Dispute Ticket',
}

function isOverdue(expectHandleTime: string, nowMs: number): boolean {
  if (!expectHandleTime) return false
  const ms = iMileStrToMs(expectHandleTime)
  return Number.isFinite(ms) && ms < nowMs
}

/** iMile 返回的 expectHandleTime 是墨尔本本地时间字符串，转换到账号时区展示，避免跨州账号误读 */
function formatDeadline(expectHandleTime: string, tz: AusTz): string {
  if (!expectHandleTime) return 'Not set'
  const ms = iMileStrToMs(expectHandleTime)
  if (!Number.isFinite(ms)) return expectHandleTime
  return `${localDateTimeInTz(ms, tz)} (${tzDisplayName(tz)})`
}

/**
 * 构建工单推送飞书卡片（webhook interactive card v1）。一家供应商一张卡片，
 * 只在该供应商有未处理工单时才会构建/推送（totalCount 恒 > 0，无“无异常”态）。
 */
export function buildWorkOrderPushCard(params: {
  vendorName: string
  baseDate: string
  pushTime: string
  /** 计算 baseDate/pushTime 所用的账号时区，也用于 Deadline 展示换算 */
  tz: AusTz
  summary: WorkOrderPushVendorSummary
  pushDescription?: string | null
  /** 命中「是否 @ 相关人员」时传入，供应商配置花名册里选中的全部联系人 */
  mentions?: SupplierMentionContact[] | null
  nowMs?: number
}): Record<string, unknown> {
  const { vendorName, baseDate, pushTime, tz, summary, pushDescription, mentions } = params
  const nowMs = params.nowMs ?? Date.now()
  const { totalCount, normalCount, complaintCount, arbitrationCount, tickets } = summary
  const elements: CardEl[] = []

  if (pushDescription) {
    elements.push(div(colored(pushDescription, 'grey')))
    elements.push(hr())
  }

  const breakdown = [
    normalCount > 0 ? `Normal: ${colored(String(normalCount), 'red')}` : '',
    complaintCount > 0 ? `Complaint: ${colored(String(complaintCount), 'red')}` : '',
    arbitrationCount > 0 ? `Dispute: ${colored(String(arbitrationCount), 'red')}` : '',
  ]
    .filter(Boolean)
    .join(' ｜ ')

  elements.push(
    div(
      [`**Unresolved tickets** ${colored(`**${totalCount}**`, 'red')}`, breakdown]
        .filter(Boolean)
        .join(' ｜ '),
    ),
  )

  if (tickets.length > 0) {
    elements.push(hr())
    const byType = new Map<string, typeof tickets>()
    for (const t of tickets) {
      if (!byType.has(t.type)) byType.set(t.type, [])
      byType.get(t.type)!.push(t)
    }
    const blocks = (['normal', 'complaint', 'arbitration'] as const)
      .filter((type) => byType.has(type))
      .map((type) => {
        const group = byType.get(type)!
        const shown = group.slice(0, MAX_TICKET_LINES)
        const lines = shown.map((t) => {
          const overdue = isOverdue(t.expectHandleTime, nowMs)
          const deadlineValue = formatDeadline(t.expectHandleTime, tz)
          const deadline = colored(deadlineValue, overdue ? 'red' : 'grey')
          return `· ${t.orderCode || '(no ticket no.)'} **Waybill** ${t.waybillNo} · **Deadline** ${deadline}`
        })
        if (group.length > MAX_TICKET_LINES) {
          lines.push(`+ ${group.length - MAX_TICKET_LINES} more`)
        }
        return `**${TYPE_LABEL[type]} (${group.length})**\n${lines.join('\n')}`
      })
    elements.push(div(blocks.join('\n\n')))
  }

  elements.push(hr())
  elements.push(div(colored('⚠️ Overdue tickets will incur penalty/compensation fees. Please handle immediately.', 'red')))
  elements.push(openUrlAction(PCS_TICKET_WORKBENCH_URL, 'Click to Resolve Tickets'))
  elements.push(note(`${baseDate} ${pushTime} (${tzDisplayName(tz)}) · Ticket push · iMile Warehouse Management System`))

  const mentionLarkMd = buildMentionLarkMd(mentions)
  if (mentionLarkMd) {
    elements.push(div(mentionLarkMd))
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'purple',
      title: {
        tag: 'plain_text',
        content: `Unresolved Ticket Alert - ${vendorName}`,
      },
    },
    elements,
  }
}
