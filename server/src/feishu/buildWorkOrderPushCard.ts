import { iMileStrToMs } from '../imile/ausTimezone'
import type { WorkOrderPushVendorSummary } from '../vendorAnalysis/workOrderPushAggregate'

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

const TYPE_LABEL: Record<string, string> = {
  normal: '普通',
  complaint: '客诉',
  arbitration: '仲裁',
}

function isOverdue(expectHandleTime: string, nowMs: number): boolean {
  if (!expectHandleTime) return false
  const ms = iMileStrToMs(expectHandleTime)
  return Number.isFinite(ms) && ms < nowMs
}

/**
 * 构建工单推送飞书卡片（webhook interactive card v1）。一家供应商一张卡片，
 * 只在该供应商有未处理工单时才会构建/推送（totalCount 恒 > 0，无“无异常”态）。
 */
export function buildWorkOrderPushCard(params: {
  vendorName: string
  baseDate: string
  pushTime: string
  summary: WorkOrderPushVendorSummary
  pushDescription?: string | null
  nowMs?: number
}): Record<string, unknown> {
  const { vendorName, baseDate, pushTime, summary, pushDescription } = params
  const nowMs = params.nowMs ?? Date.now()
  const { totalCount, normalCount, complaintCount, arbitrationCount, tickets } = summary
  const elements: CardEl[] = []

  if (pushDescription) {
    elements.push(div(colored(pushDescription, 'grey')))
    elements.push(hr())
  }

  const breakdown = [
    normalCount > 0 ? `普通: ${colored(String(normalCount), 'red')}` : '',
    complaintCount > 0 ? `客诉: ${colored(String(complaintCount), 'red')}` : '',
    arbitrationCount > 0 ? `仲裁: ${colored(String(arbitrationCount), 'red')}` : '',
  ]
    .filter(Boolean)
    .join(' ｜ ')

  elements.push(
    div(
      [`**未处理工单合计** ${colored(`**${totalCount}**`, 'red')}`, breakdown]
        .filter(Boolean)
        .join(' ｜ '),
    ),
  )

  if (tickets.length > 0) {
    elements.push(hr())
    const shown = tickets.slice(0, MAX_TICKET_LINES)
    const lines = shown.map((t) => {
      const overdue = isOverdue(t.expectHandleTime, nowMs)
      const deadline = t.expectHandleTime
        ? colored(t.expectHandleTime, overdue ? 'red' : 'grey')
        : colored('未设置', 'grey')
      return `· [${TYPE_LABEL[t.type] ?? t.type}] ${t.orderCode || '(无工单号)'} 运单 ${t.waybillNo} · 最晚处理: ${deadline}`
    })
    if (tickets.length > MAX_TICKET_LINES) {
      lines.push(`及其他 ${tickets.length - MAX_TICKET_LINES} 条`)
    }
    elements.push(div(lines.join('\n')))
  }

  elements.push(hr())
  elements.push(div(colored('⚠️ 逾期未处理将产生罚款/赔偿费用，请尽快处理', 'red')))
  elements.push(note(`${baseDate} ${pushTime} · Work order push · iMile Warehouse Management System`))

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'red',
      title: {
        tag: 'plain_text',
        content: `⚠️ 未处理工单提醒 - ${vendorName}`,
      },
    },
    elements,
  }
}
