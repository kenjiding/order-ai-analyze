import type { Dispatch24hDriverStat } from '../vendorAnalysis/dispatch24hAggregate'

type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue'

const MAX_DRIVER_LINES = 20

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

function columnSet(columns: CardEl[]): CardEl {
  return { tag: 'column_set', flex_mode: 'bisect', background_style: 'default', columns }
}

/** 自定义机器人 v1 卡片：用 action + button.url 打开落地页（markdown 链接不可跳转） */
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

function summaryTile(label: string, value: string, sub: string, valueColor: MarkColor): CardEl {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'grey',
    elements: [div([`**${label}**`, colored(`**${value}**`, valueColor), colored(sub, 'grey')].join('\n'))],
  }
}

/**
 * 构建 24 小时签收率告警飞书卡片（webhook interactive card v1）。
 * “派签率”口径实为“24小时内签收率”（deliveryTime 起 24h 内 signDate/lastProblemDate），
 * 卡片英文措辞按“delivery/signed”表达，不用字面 dispatch。
 * 达标数据来自「供应商数据分析」封装复用出来的 aggregateDispatch24hByVendor，一家供应商一张卡片，
 * 明细按司机（courierCode）汇总未达标数，而非罗列单个运单号，便于定位具体司机。
 */
export function buildDispatchAlarmCard(params: {
  vendorName: string
  stationCode: string
  date: string
  pushTime: string
  total: number
  met: number
  drivers: Dispatch24hDriverStat[]
  alertThresholdPct: number
  pushDescription?: string | null
  /** 无登录落地页：查看并复制未达标运单号 */
  detailUrl?: string | null
}): Record<string, unknown> {
  const { vendorName, stationCode, date, pushTime, total, met, drivers, alertThresholdPct, pushDescription, detailUrl } = params
  const elements: CardEl[] = []

  const unmet = total - met
  const rate = total > 0 ? (met / total) * 100 : 0
  const rateText = total > 0 ? `${rate.toFixed(1)}%` : '—'
  const isAlert = total > 0 && rate < alertThresholdPct

  elements.push(
    div(
      [
        `📮 **Responsible vendor: ${vendorName}**`,
        colored(`Station: ${stationCode} · ${date} ${pushTime} (Adelaide)`, 'grey'),
        pushDescription ? colored(pushDescription, 'grey') : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  )

  elements.push(hr())

  elements.push(
    columnSet([
      summaryTile('24H delivery rate', rateText, `Threshold ${alertThresholdPct}%`, isAlert ? 'red' : 'green'),
      summaryTile('Not signed within 24H', `${unmet}`, `${total} waybills total`, unmet > 0 ? 'red' : 'green'),
    ]),
  )

  elements.push(hr())

  const unmetDrivers = drivers.filter((d) => d.total - d.met > 0)
  if (unmetDrivers.length === 0) {
    elements.push(div(colored('✅ All waybills signed within 24H', 'green')))
  } else {
    const shown = unmetDrivers.slice(0, MAX_DRIVER_LINES)
    const lines = shown.map((d) => {
      const driverUnmet = d.total - d.met
      return `· **${d.courierName}** (${d.courierCode}) ${colored(`${driverUnmet} not signed`, 'red')} / ${d.total} total`
    })
    if (unmetDrivers.length > MAX_DRIVER_LINES) {
      lines.push(`及其他 ${unmetDrivers.length - MAX_DRIVER_LINES} 位司机`)
    }
    elements.push(
      div(`🚨 **Drivers with waybills not signed within 24H (${unmetDrivers.length})**\n${lines.join('\n')}`),
    )
  }

  if (detailUrl && unmet > 0) {
    elements.push(hr())
    elements.push(openUrlAction(detailUrl, 'View & copy waybills'))
  }

  elements.push(hr())
  elements.push(note(`${date} ${pushTime} · 24H delivery rate monitoring · iMile Warehouse Management System`))

  return {
    config: { wide_screen_mode: true },
    header: {
      template: isAlert ? 'red' : 'green',
      title: {
        tag: 'plain_text',
        content: isAlert ? `🚨 24H delivery alert - ${vendorName}` : `✅ 24H delivery on track - ${vendorName}`,
      },
    },
    elements,
  }
}
