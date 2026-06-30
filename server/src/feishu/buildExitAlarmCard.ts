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
      ? colored('✅ 已全部出仓', 'green')
      : colored(`**还有 ${pending} 单未出仓**`, pendingColor),
    colored(`已出 ${exited} / 共 ${total} 单 · ${rate}%`, 'grey'),
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
        `📦 **责任单位：${vendorName}**`,
        colored(`站点：${stationCode} · ${date} ${pushTime} (Adelaide)`, 'grey'),
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
        '待出仓运单（合计）',
        `${totalPending} 单`,
        `本时段共 ${totalWaybills} 单`,
        totalPending > 0 ? 'red' : 'green',
      ),
      summaryTile('当前出仓率', `${exitRate}%`, `已出仓 ${exited} 单`, rateColor),
    ]),
  )

  elements.push(hr())

  // 各路由码明细磁贴
  const allZones = Object.entries(zoneBreakdown).sort((a, b) => b[1].pending - a[1].pending)

  if (allZones.length === 0) {
    elements.push(div(colored('✅ 暂无运单数据', 'grey')))
  } else {
    const pendingCount = allZones.filter(([, s]) => s.pending > 0).length
    elements.push(
      div(
        pendingCount > 0
          ? `🚨 **各路由码出仓情况** — 还有 ${pendingCount} 条路由未完成，请立即通知司机！`
          : `✅ **各路由码出仓情况** — 全部已完成！`,
      ),
    )

    // 每两个路由码一行
    for (let i = 0; i < allZones.length; i += 2) {
      const pair = allZones.slice(i, i + 2)
      const cols = pair.map(([code, { pending, total }]) => {
        const bg: BgStyle =
          pending === 0 ? 'green' : pending >= 10 ? 'red' : pending >= 5 ? 'orange' : 'grey'
        return zoneTile(code, pending, total, bg)
      })
      if (cols.length === 1) cols.push(emptyCol())
      elements.push(columnSet(cols, 'bisect'))
    }
  }

  elements.push(hr())
  elements.push(note(`${date} ${pushTime} · 11点前出仓监控 · iMile 仓库管理系统`))

  const isUrgent = totalPending > 0
  return {
    config: { wide_screen_mode: true },
    header: {
      template: isUrgent ? 'red' : 'green',
      title: {
        tag: 'plain_text',
        content: isUrgent ? `🚨 出仓告警 - ${vendorName}` : `✅ 出仓正常 - ${vendorName}`,
      },
    },
    elements,
  }
}
