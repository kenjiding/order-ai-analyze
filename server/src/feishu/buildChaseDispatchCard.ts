import type { VendorStagnationSummary } from '../imile/chaseDispatchAggregate'

type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue'

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

/** 构建催派推送飞书卡片（webhook interactive card v1）。一家供应商一张卡片 */
export function buildChaseDispatchCard(params: {
  vendorName: string
  baseDate: string
  pushTime: string
  summary: VendorStagnationSummary
  pushDescription?: string | null
}): Record<string, unknown> {
  const { vendorName, baseDate, pushTime, summary, pushDescription } = params
  const { totalStagnant, buckets } = summary
  const elements: CardEl[] = []

  // 供应商名称已在卡片 header 展示，此处仅可选地展示推送说明
  if (pushDescription) {
    elements.push(div(colored(pushDescription, 'grey')))
    elements.push(hr())
  }

  // Total stagnant orders + per-stagnation-range, shown on one line
  const totalColor: MarkColor = totalStagnant >= 20 ? 'red' : totalStagnant >= 10 ? 'orange' : totalStagnant > 0 ? 'blue' : 'green'
  const activeBuckets = buckets.filter((b) => b.count > 0)
  const bucketInline = activeBuckets
    .map((b) => `${b.label.replace(/\s*天$/, '')} days: ${colored(String(b.count), 'red')}`)
    .join(' ｜ ')
  elements.push(
    div(
      [
        `**Total stagnant orders** ${colored(`**${totalStagnant}**`, totalColor)}`,
        bucketInline,
      ]
        .filter(Boolean)
        .join(' ｜ '),
    ),
  )

  // Per driver, grouped by stagnation range
  const bucketsWithDrivers = activeBuckets.filter((b) => b.drivers.length > 0)
  if (bucketsWithDrivers.length > 0) {
    elements.push(hr())
    const bucketBlocks = bucketsWithDrivers.map((b) => {
      const driverLines = b.drivers
        .map((d) => `· ${d.driverName} (${d.driverCode}): ${colored(`${d.count}`, d.count >= 10 ? 'red' : 'grey')}`)
        .join('\n')
      return `**${b.bucket} days:**\n${driverLines}`
    })
    elements.push(div(`**By driver**\n${bucketBlocks.join('\n')}`))
  }

  if (totalStagnant === 0) {
    elements.push(hr())
    elements.push(div(colored('✅ No stagnant orders', 'green')))
  }

  elements.push(hr())
  elements.push(note(`${baseDate} ${pushTime} · Chase dispatch · iMile Warehouse Management System`))

  const isUrgent = totalStagnant > 0
  return {
    config: { wide_screen_mode: true },
    header: {
      template: isUrgent ? 'orange' : 'green',
      title: {
        tag: 'plain_text',
        content: isUrgent ? `🚚 Chase dispatch - ${vendorName}` : `✅ No stagnant orders - ${vendorName}`,
      },
    },
    elements,
  }
}
