type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue'
type BgStyle = 'default' | 'grey' | 'red' | 'orange' | 'green' | 'blue'

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

function columnSet(columns: CardEl[], flexMode: 'bisect' | 'trisect' = 'bisect'): CardEl {
  return { tag: 'column_set', flex_mode: flexMode, background_style: 'default', columns }
}

function summaryTile(label: string, value: string, sub: string, valueColor: MarkColor): CardEl {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'grey',
    elements: [
      div([`**${label}**`, colored(`**${value}**`, valueColor), colored(sub, 'grey')].join('\n')),
    ],
  }
}

function zoneTile(
  routeCode: string,
  pending: number,
  total: number,
  bg: BgStyle,
): CardEl {
  const exited = total - pending
  const rate = total > 0 ? ((exited / total) * 100).toFixed(0) : '0'
  const pendingColor: MarkColor =
    pending === 0 ? 'green' : pending >= 10 ? 'red' : pending >= 5 ? 'orange' : 'grey'
  const lines = [
    `**${routeCode}**`,
    pending === 0
      ? colored('✅ All exited by 11:00', 'green')
      : colored(`**${pending} not exited by 11:00**`, pendingColor),
    colored(`Exited by 11:00 ${exited} / ${total} total · ${rate}%`, 'grey'),
  ]
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: bg,
    elements: [div(lines.join('\n'))],
  }
}

function emptyCol(): CardEl {
  return { tag: 'column', width: 'weighted', weight: 1, elements: [] }
}

export type ZoneStats = {
  pending: number
  total: number
}

/** 构建出仓告警飞书卡片（webhook interactive card v1） */
export function buildExitAlarmCard(params: {
  vendorName: string
  stationCode: string
  date: string
  pushTime: string
  zoneBreakdown: Record<string, ZoneStats>
  totalPending: number
  totalWaybills: number
  pushDescription?: string | null
}): Record<string, unknown> {
  const {
    vendorName,
    stationCode,
    date,
    pushTime,
    zoneBreakdown,
    totalPending,
    totalWaybills,
    pushDescription,
  } = params
  const elements: CardEl[] = []

  const exited = totalWaybills - totalPending
  const exitRate = totalWaybills > 0 ? ((exited / totalWaybills) * 100).toFixed(1) : '0.0'
  const exitRateNum = totalWaybills > 0 ? (exited / totalWaybills) * 100 : 0

  // 标题行
  elements.push(
    div(
      [
        `📦 **Responsible vendor: ${vendorName}**`,
        colored(`Station: ${stationCode} · ${date} ${pushTime} (Adelaide)`, 'grey'),
        pushDescription ? colored(pushDescription, 'grey') : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  )

  elements.push(hr())

  // 汇总 KPI
  const rateColor: MarkColor = exitRateNum >= 80 ? 'green' : exitRateNum >= 60 ? 'orange' : 'red'
  elements.push(
    columnSet([
      summaryTile(
        'Not exited by 11:00',
        `${totalPending}`,
        `${totalWaybills} waybills total`,
        totalPending > 0 ? 'red' : 'green',
      ),
      summaryTile('Pre-11am exit rate', `${exitRate}%`, `${exited} exited on time`, rateColor),
    ]),
  )

  elements.push(hr())

  // 各路由码明细磁贴：出仓率高于 90% 视为达标，不展示
  const COMPLIANT_RATE = 90
  const pendingZones = Object.entries(zoneBreakdown)
    .filter(([, s]) => s.pending > 0 && (s.total > 0 ? ((s.total - s.pending) / s.total) * 100 : 0) <= COMPLIANT_RATE)
    .sort((a, b) => b[1].pending - a[1].pending)

  if (pendingZones.length === 0) {
    elements.push(div(colored('✅ All routes meet pre-11am exit target', 'green')))
  } else {
    elements.push(div(`🚨 **Routes not exited by 11:00 (${pendingZones.length})** — Notify drivers now!`))
    for (let i = 0; i < pendingZones.length; i += 2) {
      const pair = pendingZones.slice(i, i + 2)
      const cols = pair.map(([code, { pending, total }]) => zoneTile(code, pending, total, 'default'))
      if (cols.length === 1) cols.push(emptyCol())
      elements.push(columnSet(cols, 'bisect'))
    }
  }

  elements.push(hr())
  elements.push(note(`${date} ${pushTime} · Pre-11am dispatch monitoring · iMile Warehouse Management System`))

  const isUrgent = totalPending > 0
  return {
    config: { wide_screen_mode: true },
    header: {
      template: isUrgent ? 'red' : 'green',
      title: {
        tag: 'plain_text',
        content: isUrgent ? `🚨 Dispatch alert - ${vendorName}` : `✅ Dispatch on track - ${vendorName}`,
      },
    },
    elements,
  }
}
