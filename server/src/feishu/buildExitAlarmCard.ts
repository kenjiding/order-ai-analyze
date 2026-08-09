import { tzDisplayName, type AusTz } from '../imile/ausTimezone'
import { buildMentionLarkMd, type SupplierMentionContact } from './feishuMentionHelpers'

type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue'

/** 磁贴柔和背景色——用卡片色板的 -50 浅色阶，避免纯色背景对比度过强 */
const TILE_BG: Record<MarkColor, string> = {
  red: 'red-50',
  orange: 'orange-50',
  green: 'green-50',
  grey: 'grey-50',
  blue: 'blue-50',
}

function md(content: string, extra?: CardEl): CardEl {
  return { tag: 'markdown', content, ...extra }
}

function hr(): CardEl {
  return { tag: 'hr' }
}

/** JSON 2.0 不再支持 note 组件，用小号灰字的 markdown 代替页脚说明文案 */
function footerCaption(content: string): CardEl {
  return md(colored(content, 'grey'), { text_size: 'notation' })
}

function colored(value: string, color: MarkColor): string {
  return `<font color='${color}'>${value}</font>`
}

function columnSet(columns: CardEl[], flexMode: 'bisect' | 'trisect' = 'bisect'): CardEl {
  return {
    tag: 'column_set',
    flex_mode: flexMode,
    background_style: 'default',
    horizontal_spacing: 'small',
    columns,
  }
}

function summaryTile(label: string, value: string, sub: string, valueColor: MarkColor): CardEl {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: TILE_BG[valueColor],
    padding: '8px 10px 8px 10px',
    elements: [
      md([`**${label}**`, colored(`**${value}**`, valueColor), colored(sub, 'grey')].join('\n')),
    ],
  }
}

function zoneTile(routeCode: string, pending: number, total: number): CardEl {
  const exited = total - pending
  const rate = total > 0 ? ((exited / total) * 100).toFixed(0) : '0'
  const pendingColor: MarkColor =
    pending === 0 ? 'green' : pending >= 10 ? 'red' : pending >= 5 ? 'orange' : 'grey'
  const firstLine = `**${routeCode}** - ${
    pending === 0 ? colored('✅ All exited', 'green') : colored(`${pending} not exited`, pendingColor)
  }`
  const secondLine = colored(`${exited} / ${total} total · ${rate}%`, 'grey')
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'default',
    padding: '8px 10px 8px 10px',
    elements: [md([firstLine, secondLine].join('\n'))],
  }
}

function emptyCol(): CardEl {
  return { tag: 'column', width: 'weighted', weight: 1, elements: [] }
}

export type ZoneStats = {
  pending: number
  total: number
}

export type WhitelistStat = {
  totalWaybills: number
  zoneBreakdown: Record<string, ZoneStats>
}

/**
 * 路由码白名单出仓数据——折叠面板（collapsible_panel，JSON 2.0 结构），
 * 追加在主卡片末尾，默认折叠（expanded: false），点击后展开；不再作为独立第二条消息推送。
 * 统计对象是主卡片里被剔除的那部分白名单路由数据，展示口径与主卡片一致。
 * 面板与标题背景取柔和的浅色阶（grey-50 / blue-50），与卡片其余磁贴的色调保持一致。
 */
function buildWhitelistPanel(whitelistStat: WhitelistStat): CardEl {
  const { totalWaybills, zoneBreakdown } = whitelistStat
  const totalPending = Object.values(zoneBreakdown).reduce((s, v) => s + v.pending, 0)
  const exited = totalWaybills - totalPending
  const exitRate = totalWaybills > 0 ? ((exited / totalWaybills) * 100).toFixed(1) : '0.0'
  const exitRateNum = totalWaybills > 0 ? (exited / totalWaybills) * 100 : 0
  const rateColor: MarkColor = exitRateNum >= 80 ? 'green' : exitRateNum >= 60 ? 'orange' : 'red'

  const panelElements: CardEl[] = [
    columnSet([
      summaryTile('Exited by 11:00', `${exited}`, `${totalWaybills} waybills total`, 'blue'),
      summaryTile('Whitelisted exit rate', `${exitRate}%`, `${exited} / ${totalWaybills} exited`, rateColor),
    ]),
  ]

  const zones = Object.entries(zoneBreakdown).sort((a, b) => b[1].pending - a[1].pending)
  if (zones.length === 0) {
    panelElements.push(md(colored('No whitelisted route data', 'grey')))
  } else {
    for (let i = 0; i < zones.length; i += 2) {
      const pair = zones.slice(i, i + 2)
      const cols = pair.map(([code, { pending, total }]) => zoneTile(code, pending, total))
      if (cols.length === 1) cols.push(emptyCol())
      panelElements.push(columnSet(cols, 'bisect'))
    }
  }

  return {
    tag: 'collapsible_panel',
    expanded: false,
    background_color: 'blue-50',
    header: {
      title: {
        tag: 'markdown',
        content: `**🔓 Whitelisted routes (${totalWaybills} waybills · ${exitRate}% exited)**`,
      },
      background_color: 'blue-50',
      vertical_align: 'center',
      padding: '4px 0px 4px 8px',
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
      icon_position: 'follow_text',
      icon_expanded_angle: -180,
    },
    border: { color: 'grey-200', corner_radius: '5px' },
    vertical_spacing: '2px',
    padding: '4px 4px 4px 4px',
    elements: panelElements,
  }
}

/** 构建出仓告警飞书卡片（card JSON 2.0 结构） */
export function buildExitAlarmCard(params: {
  vendorName: string
  stationCode: string
  date: string
  pushTime: string
  /** 计算 date/pushTime 所用的账号时区，用于卡片上的时区标签 */
  tz: AusTz
  zoneBreakdown: Record<string, ZoneStats>
  totalPending: number
  totalWaybills: number
  pushDescription?: string | null
  /** 命中「是否 @ 相关人员」时传入，供应商配置花名册里选中的全部联系人 */
  mentions?: SupplierMentionContact[] | null
  /** 命中「路由码白名单数据推送」且有命中数据时传入，作为折叠面板追加在主卡片末尾，默认折叠 */
  whitelistStat?: WhitelistStat | null
}): Record<string, unknown> {
  const {
    vendorName,
    stationCode,
    date,
    pushTime,
    tz,
    zoneBreakdown,
    totalPending,
    totalWaybills,
    pushDescription,
    mentions,
    whitelistStat,
  } = params
  const elements: CardEl[] = []

  const exited = totalWaybills - totalPending
  const exitRate = totalWaybills > 0 ? ((exited / totalWaybills) * 100).toFixed(1) : '0.0'
  const exitRateNum = totalWaybills > 0 ? (exited / totalWaybills) * 100 : 0

  // 标题行
  elements.push(
    md(
      [
        `📦 **Responsible vendor: ${vendorName}**`,
        colored(`Station: ${stationCode} · ${date} ${pushTime} (${tzDisplayName(tz)})`, 'grey'),
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
    elements.push(md(colored('✅ All routes meet pre-11am exit target', 'green')))
  } else {
    elements.push(md(`🚨 **Routes not exited by 11:00 (${pendingZones.length})** — Notify drivers now!`))
    for (let i = 0; i < pendingZones.length; i += 2) {
      const pair = pendingZones.slice(i, i + 2)
      const cols = pair.map(([code, { pending, total }]) => zoneTile(code, pending, total))
      if (cols.length === 1) cols.push(emptyCol())
      elements.push(columnSet(cols, 'bisect'))
    }
  }

  if (whitelistStat && whitelistStat.totalWaybills > 0) {
    elements.push(hr())
    elements.push(buildWhitelistPanel(whitelistStat))
  }

  elements.push(hr())
  elements.push(footerCaption(`${date} ${pushTime} · Pre-11am dispatch monitoring · iMile Warehouse Management System`))

  const mentionLarkMd = buildMentionLarkMd(mentions)
  if (mentionLarkMd) {
    elements.push(md(mentionLarkMd))
  }

  const isUrgent = totalPending > 0
  return {
    schema: '2.0',
    header: {
      template: isUrgent ? 'orange' : 'green',
      title: {
        tag: 'plain_text',
        content: isUrgent
          ? `11 Am Dispatch alert - ${vendorName}`
          : `11 Am Dispatch on track - ${vendorName}`,
      },
    },
    body: {
      direction: 'vertical',
      vertical_spacing: '2px',
      elements,
    },
  }
}
