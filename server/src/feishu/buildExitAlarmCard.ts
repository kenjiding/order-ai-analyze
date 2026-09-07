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

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

function colored(value: string, color: MarkColor): string {
  return `<font color='${color}'>${value}</font>`
}

function columnSet(columns: CardEl[], flexMode: 'none' | 'bisect' | 'trisect' = 'bisect'): CardEl {
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
      md([`**${label}**`, colored(`**${value}**`, valueColor), sub ? colored(sub, 'grey') : '']
        .filter(Boolean)
        .join('\n')),
    ],
  }
}

function zoneTile(routeCode: string, pending: number, total: number, priority: number): CardEl {
  const exited = total - pending
  const rate = total > 0 ? ((exited / total) * 100).toFixed(0) : '0'
  // 首行不再报未出仓件数，改报该路由的「本地件优先客户」包裹数——供应商据此优先清这批件
  const priorityColor: MarkColor = priority === 0 ? 'grey' : priority >= 10 ? 'red' : 'orange'
  const firstLine = `**${routeCode}** - ${colored(`${priority} Priorities`, priorityColor)}`
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
  /** 「本地件优先客户」包裹数（clientCode 命中「优先客户配置」） */
  priority: number
  /** 其中已在阈值前出仓的件数 */
  priorityExited: number
}

export type WhitelistStat = {
  totalWaybills: number
  zoneBreakdown: Record<string, ZoneStats>
}

/** 只有全部出仓（pending === 0）的路由才隐藏，不再按出仓率阈值剔除——主统计与白名单面板共用同一口径 */
function filterNonCompliantZones(
  zoneBreakdown: Record<string, ZoneStats>,
): [string, ZoneStats][] {
  return Object.entries(zoneBreakdown)
    .filter(([, s]) => s.pending > 0)
    .sort((a, b) => b[1].pending - a[1].pending)
}

/**
 * 路由码白名单出仓数据——折叠面板（collapsible_panel，JSON 2.0 结构），
 * 追加在主卡片末尾，默认折叠（expanded: false），点击后展开；不再作为独立第二条消息推送。
 * 统计对象是主卡片里被剔除的那部分白名单路由数据，展示口径与主卡片一致。
 * 面板与标题背景取柔和的浅色阶（grey-50 / blue-50），与卡片其余磁贴的色调保持一致。
 */
function buildWhitelistPanel(whitelistStat: WhitelistStat, pushTime: string): CardEl {
  const { totalWaybills, zoneBreakdown } = whitelistStat
  const totalPending = Object.values(zoneBreakdown).reduce((s, v) => s + v.pending, 0)
  const exited = totalWaybills - totalPending
  const exitRate = totalWaybills > 0 ? ((exited / totalWaybills) * 100).toFixed(1) : '0.0'
  const exitRateNum = totalWaybills > 0 ? (exited / totalWaybills) * 100 : 0
  const rateColor: MarkColor = exitRateNum >= 80 ? 'green' : exitRateNum >= 60 ? 'orange' : 'red'

  const panelElements: CardEl[] = [
    columnSet([
      summaryTile(`Exited by ${pushTime}`, `${exited}`, `${totalWaybills} waybills total`, 'blue'),
      summaryTile('Whitelisted exit rate', `${exitRate}%`, `${exited} / ${totalWaybills} exited`, rateColor),
    ]),
  ]

  // 只隐藏全部出仓的路由——跟主统计的路由明细磁贴口径保持一致
  const pendingZones = filterNonCompliantZones(zoneBreakdown)
  if (pendingZones.length === 0) {
    panelElements.push(md(colored('✅ All whitelisted routes meet exit target', 'green')))
  } else {
    for (let i = 0; i < pendingZones.length; i += 2) {
      const pair = pendingZones.slice(i, i + 2)
      const cols = pair.map(([code, { pending, total, priority }]) => zoneTile(code, pending, total, priority))
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
        content: '**Click to expand: Whitelisted Routes**',
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
  /** 滞留清货价：每件清货补贴（美元）；配置了且有未出仓件时展示清货费用 */
  clearancePrice?: number | null
}): Record<string, unknown> {
  const {
    vendorName,
    date,
    pushTime,
    tz,
    zoneBreakdown,
    totalPending,
    totalWaybills,
    pushDescription,
    mentions,
    whitelistStat,
    clearancePrice,
  } = params
  const elements: CardEl[] = []

  const exited = totalWaybills - totalPending
  const exitRate = totalWaybills > 0 ? ((exited / totalWaybills) * 100).toFixed(1) : '0.0'

  // 标题行
  elements.push(
    md(
      [
        `📦 **Responsible vendor: ${vendorName}**`,
        colored(`${date} ${pushTime} (${tzDisplayName(tz)})`, 'grey'),
        pushDescription ? colored(pushDescription, 'grey') : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  )

  elements.push(hr())

  // 汇总 KPI；配置了滞留清货价且有滞留件时，清货费用并入同一行。
  // 每块磁贴各占一种色相，避免整行同色分不出块：滞留量=红、出仓率=蓝（中性指标）、
  // 优先客户=橙、清货费用=灰；数量清零时相应磁贴转绿。与 24H 派签告警卡片同一套配色。
  // 「本地件优先客户」包裹数按分区明细汇总，口径与 totalWaybills 一致（白名单路由已单列，不在其中）
  const totalPriority = Object.values(zoneBreakdown).reduce((sum, zone) => sum + zone.priority, 0)
  const exitedPriority = Object.values(zoneBreakdown).reduce((sum, zone) => sum + zone.priorityExited, 0)
  const pendingPriority = totalPriority - exitedPriority
  const kpiTiles = [
    summaryTile('Not exited', `${totalPending}`, `${totalWaybills} total`, totalPending > 0 ? 'red' : 'green'),
    summaryTile('Exit rate', `${exitRate}%`, `${exited} exited on time`, 'blue'),
    summaryTile(
      'Priority Packages',
      `${pendingPriority} Not exited`,
      `${totalPriority} total`,
      pendingPriority > 0 ? 'orange' : 'green',
    ),
  ]
  if (clearancePrice && clearancePrice > 0 && totalPending > 0) {
    kpiTiles.push(summaryTile('Clearance cost', money(totalPending * clearancePrice), '', 'grey'))
  }
  elements.push(columnSet(kpiTiles, kpiTiles.length === 3 ? 'trisect' : 'none'))

  elements.push(hr())

  // 各路由码明细磁贴：只有全部出仓（未出仓 0 件）的路由不展示
  const pendingZones = filterNonCompliantZones(zoneBreakdown)

  if (pendingZones.length === 0) {
    elements.push(md(colored(`✅ All routes meet ${pushTime} exit target`, 'green')))
  } else {
    elements.push(md(`🚨 **Routes not exited by ${pushTime} (${pendingZones.length})** — Notify drivers now!`))
    for (let i = 0; i < pendingZones.length; i += 2) {
      const pair = pendingZones.slice(i, i + 2)
      const cols = pair.map(([code, { pending, total, priority }]) => zoneTile(code, pending, total, priority))
      if (cols.length === 1) cols.push(emptyCol())
      elements.push(columnSet(cols, 'bisect'))
    }
  }

  if (whitelistStat && whitelistStat.totalWaybills > 0) {
    elements.push(hr())
    elements.push(buildWhitelistPanel(whitelistStat, pushTime))
  }

  elements.push(hr())
  elements.push(footerCaption(`${date} ${pushTime} · iMile Warehouse Management System`))

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
          ? `${pushTime} Dispatch alert - ${vendorName}`
          : `${pushTime} Dispatch on track - ${vendorName}`,
      },
    },
    body: {
      direction: 'vertical',
      vertical_spacing: '2px',
      elements,
    },
  }
}
