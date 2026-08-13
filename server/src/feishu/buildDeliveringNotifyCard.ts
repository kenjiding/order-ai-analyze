import { tzDisplayName, type AusTz } from '../imile/ausTimezone'

type CardEl = Record<string, unknown>

function div(content: string): CardEl {
  return { tag: 'div', text: { tag: 'lark_md', content } }
}

function sectionHeading(icon: string, title: string): CardEl {
  return { tag: 'markdown', content: `**${icon} ${title}**`, text_size: 'heading' }
}

function hr(): CardEl {
  return { tag: 'hr' }
}

function note(content: string): CardEl {
  return { tag: 'note', elements: [{ tag: 'lark_md', content }] }
}

function colored(value: string, color: 'red' | 'orange' | 'green' | 'grey' | 'blue'): string {
  return `<font color='${color}'>${value}</font>`
}

export type DeliveringNotifyCourierGroup = {
  courier: string
  courierCode: string
  waybillNos: string[]
}

function parcelWord(n: number): string {
  return n === 1 ? 'parcel' : 'parcels'
}

function courierCount(groups: DeliveringNotifyCourierGroup[]): number {
  return groups.reduce((sum, c) => sum + c.waybillNos.length, 0)
}

function courierLabel(group: DeliveringNotifyCourierGroup): string {
  return group.courierCode ? `${group.courier} (${group.courierCode})` : group.courier || 'Unknown driver'
}

function appendCourierGroups(elements: CardEl[], groups: DeliveringNotifyCourierGroup[]): void {
  for (const group of groups) {
    elements.push(
      div(
        [
          `**${courierLabel(group)}** — ${colored(`${group.waybillNos.length} ${parcelWord(group.waybillNos.length)}`, 'orange')}`,
          group.waybillNos.join(', '),
        ].join('\n'),
      ),
    )
  }
}

function photoElement(imageKey: string): CardEl {
  return {
    tag: 'img',
    img_key: imageKey,
    alt: { tag: 'plain_text', content: 'Warehouse photo' },
    preview: true,
    // size 仅在 crop_center 生效；缩略展示，点开仍可看大图
    scale_type: 'crop_center',
    size: '240px 180px',
  }
}

/** 构建「仓内滞留包裹」飞书卡片：正在派送 / 超大件未取 两段英文（卡片对供应商展示） */
export function buildDeliveringNotifyCard(params: {
  vendorName: string
  stationCode: string
  date: string
  /** 计算 date 所用的账号时区，用于卡片上的时区标签 */
  tz: AusTz
  outForDelivery: DeliveringNotifyCourierGroup[]
  oversizedUncollected: DeliveringNotifyCourierGroup[]
  /** 已上传到飞书 IM 的现场照片 image_key，与文字同一张卡片发出 */
  imageKeys?: string[]
}): Record<string, unknown> {
  const { vendorName, stationCode, date, tz, outForDelivery, oversizedUncollected, imageKeys = [] } = params
  const totalWaybills = courierCount(outForDelivery) + courierCount(oversizedUncollected)
  const elements: CardEl[] = []

  elements.push(
    div(
      colored(
        `Station: ${stationCode} · ${date} (${tzDisplayName(tz)}) · ${totalWaybills} ${parcelWord(totalWaybills)} total`,
        'grey',
      ),
    ),
  )

  if (outForDelivery.length > 0) {
    elements.push(hr())
    elements.push(sectionHeading('🚚', 'Dispatched parcels left at the front desk'))
    appendCourierGroups(elements, outForDelivery)
  }

  if (oversizedUncollected.length > 0) {
    elements.push(hr())
    elements.push(sectionHeading('🚫', 'Parcels not collected by the driver'))
    appendCourierGroups(elements, oversizedUncollected)
  }

  if (imageKeys.length > 0) {
    elements.push(hr())
    for (const key of imageKeys) {
      elements.push(photoElement(key))
    }
  }

  elements.push(hr())
  elements.push(
    note(
      `${date} (${tzDisplayName(tz)}) · Please collect from the warehouse promptly. Uncollected parcels may be treated as lost stock.`,
    ),
  )

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'orange',
      title: { tag: 'plain_text', content: `📦 Parcels left at the warehouse - ${vendorName}` },
    },
    elements,
  }
}
