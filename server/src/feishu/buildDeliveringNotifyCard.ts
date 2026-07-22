import { tzDisplayName, type AusTz } from '../imile/ausTimezone'

type CardEl = Record<string, unknown>

function div(content: string): CardEl {
  return { tag: 'div', text: { tag: 'lark_md', content } }
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

/** 构建「派送中包裹通知」飞书卡片：提醒供应商司机尽快回仓取件（卡片文案为英文） */
export function buildDeliveringNotifyCard(params: {
  vendorName: string
  stationCode: string
  date: string
  /** 计算 date 所用的账号时区，用于卡片上的时区标签 */
  tz: AusTz
  couriers: DeliveringNotifyCourierGroup[]
}): Record<string, unknown> {
  const { vendorName, stationCode, date, tz, couriers } = params
  const totalWaybills = couriers.reduce((sum, c) => sum + c.waybillNos.length, 0)
  const parcelWord = (n: number) => (n === 1 ? 'parcel' : 'parcels')
  const elements: CardEl[] = []

  elements.push(
    div(
      [
        `📦 **Dispatched parcels left at the front desk: ${vendorName}**`,
        colored('Status: Has dispatched · Not yet collected from the warehouse front desk', 'grey'),
        colored(`Station: ${stationCode} · ${date} (${tzDisplayName(tz)}) · ${totalWaybills} ${parcelWord(totalWaybills)} total`, 'grey'),
      ].join('\n'),
    ),
  )
  elements.push(hr())

  for (const group of couriers) {
    const courierLabel = group.courierCode ? `${group.courier} (${group.courierCode})` : group.courier || 'Unknown driver'
    elements.push(
      div(
        [
          `**${courierLabel}** — ${colored(`${group.waybillNos.length} ${parcelWord(group.waybillNos.length)}`, 'orange')}`,
          group.waybillNos.join(', '),
        ].join('\n'),
      ),
    )
  }

  elements.push(hr())
  elements.push(note(`${date} (${tzDisplayName(tz)}) · Dispatched parcel reminder · Treated as lost stock if not collected promptly`))

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'orange',
      title: { tag: 'plain_text', content: `🚚 Dispatched parcels left at the front desk - ${vendorName}` },
    },
    elements,
  }
}
