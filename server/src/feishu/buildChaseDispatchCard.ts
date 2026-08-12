import type { VendorStagnationSummary } from '../imile/chaseDispatchAggregate'
import { tzDisplayName, type AusTz } from '../imile/ausTimezone'
import { buildMentionLarkMd, type SupplierMentionContact } from './feishuMentionHelpers'

type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue'

function md(content: string): CardEl {
  return { tag: 'markdown', content }
}

function hr(): CardEl {
  return { tag: 'hr' }
}

/** JSON 2.0 不再支持 note 组件，用小号灰字的 markdown 代替页脚说明文案 */
function footerCaption(content: string): CardEl {
  return { tag: 'markdown', content: colored(content, 'grey'), text_size: 'notation' }
}

function colored(value: string, color: MarkColor): string {
  return `<font color='${color}'>${value}</font>`
}

/**
 * 自定义机器人 card JSON 2.0：button 同时挂 open_url（跳转落地页，用户体验不变）+
 * callback（服务端回调，拿到点击人 open_id，见 feishuEventRouter.ts /card-callback）。
 * value 里带业务标识供回调落库用。
 */
function openUrlButton(url: string, label: string, value: Record<string, unknown>): CardEl {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type: 'primary_filled',
    width: 'default',
    size: 'medium',
    behaviors: [
      { type: 'open_url', default_url: url, pc_url: url, ios_url: url, android_url: url },
      { type: 'callback', value },
    ],
  }
}

/** 构建催派推送飞书卡片（card JSON 2.0 结构）。一家供应商一张卡片 */
export function buildChaseDispatchCard(params: {
  vendorName: string
  baseDate: string
  pushTime: string
  /** 计算 baseDate/pushTime 所用的账号时区，用于卡片上的时区标签 */
  tz: AusTz
  summary: VendorStagnationSummary
  pushDescription?: string | null
  /** 无登录落地页：查看并复制运单号 */
  detailUrl?: string | null
  /** 命中「是否 @ 相关人员」时传入，供应商配置花名册里选中的全部联系人 */
  mentions?: SupplierMentionContact[] | null
  /** 落地页按钮点击回调关联供应商用，见「推送数据监控」 */
  supplierConfigId?: string | null
}): Record<string, unknown> {
  const { vendorName, baseDate, pushTime, tz, summary, pushDescription, detailUrl, mentions, supplierConfigId } =
    params
  const { totalStagnant, buckets } = summary
  const elements: CardEl[] = []

  // 供应商名称已在卡片 header 展示，此处仅可选地展示推送说明
  if (pushDescription) {
    elements.push(md(colored(pushDescription, 'grey')))
    elements.push(hr())
  }

  // Total stagnant orders + per-stagnation-range, shown on one line
  const totalColor: MarkColor = totalStagnant >= 20 ? 'red' : totalStagnant >= 10 ? 'orange' : totalStagnant > 0 ? 'blue' : 'green'
  const activeBuckets = buckets.filter((b) => b.count > 0)
  const bucketInline = activeBuckets
    .map((b) => `${b.label.replace(/\s*天$/, '')} days: ${colored(String(b.count), 'red')}`)
    .join(' ｜ ')
  elements.push(
    md(
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
    elements.push(md(`**By driver**\n${bucketBlocks.join('\n')}`))
  }

  if (detailUrl && totalStagnant > 0) {
    elements.push(hr())
    elements.push(
      openUrlButton(detailUrl, 'Click to View Details', {
        pushType: 'chase_dispatch',
        actionType: 'view_details',
        supplierConfigId: supplierConfigId ?? '',
      }),
    )
  }

  if (totalStagnant === 0) {
    elements.push(hr())
    elements.push(
      md(
        colored(
          '✅ No overdue deliveries and no parcels pending return to warehouse. Everything is on track — thank you for the timely deliveries and returns, please keep it up!',
          'green',
        ),
      ),
    )
  } else {
    elements.push(hr())
    elements.push(md(colored('⚠️ Overdue parcels will incur fees. Please dispatch or return immediately.', 'red')))
  }

  elements.push(hr())
  elements.push(footerCaption(`${baseDate} ${pushTime} (${tzDisplayName(tz)}) · Long time - No return warehouse or Overdue Deliveries · iMile Warehouse Management System`))

  const mentionLarkMd = buildMentionLarkMd(mentions)
  if (mentionLarkMd) {
    elements.push(md(mentionLarkMd))
  }

  const isUrgent = totalStagnant > 0
  return {
    schema: '2.0',
    header: {
      template: isUrgent ? 'red' : 'green',
      title: {
        tag: 'plain_text',
        content: isUrgent
          ? `🚚⚠️ Long time - No return warehouse or Overdue Deliveries - ${vendorName}`
          : `🚚✅ Delivery & Return Check: All Clear - ${vendorName}`,
      },
    },
    body: {
      direction: 'vertical',
      elements,
    },
  }
}
