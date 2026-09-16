import type { Dispatch24hDriverStat } from '../vendorAnalysis/dispatch24hAggregate'
import { tzDisplayName, type AusTz } from '../imile/ausTimezone'
import { buildMentionLarkMd, type SupplierMentionContact } from './feishuMentionHelpers'

type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue'

const MAX_DRIVER_LINES = 20

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
  return { tag: 'markdown', content: colored(content, 'grey'), text_size: 'notation' }
}

function colored(value: string, color: MarkColor): string {
  return `<font color='${color}'>${value}</font>`
}

/**
 * 司机名原始格式类似 "MEL-KM-8857-Yanping ZHOU"，按 "-" 分隔取最后一段展示，避免推送内容过长。
 * 仅用于飞书卡片展示，落地页保留原始全名。
 */
function shortDriverName(courierName: string): string {
  const parts = courierName.split('-')
  return parts[parts.length - 1].trim() || courierName
}

/**
 * 明细行尾巴上的「本地件优先客户」包裹数：`未签 / 总数`。
 * 司机行与「未派件」行共用——未派件那批同样可能压着优先件，只显示司机行会让
 * 磁贴上的 priorityUnsigned 对不上明细（曾出现「26 未签优先件」而明细里一张都找不到）。
 */
function prioritySuffix(d: Dispatch24hDriverStat): string {
  if (d.priorityTotal <= 0) return ''
  return `. ${colored(`${d.priorityUnsigned}/${d.priorityTotal} Priorities`, 'orange')}`
}

function columnSet(columns: CardEl[]): CardEl {
  return {
    tag: 'column_set',
    flex_mode: 'trisect',
    background_style: 'default',
    horizontal_spacing: 'small',
    columns,
  }
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

function summaryTile(label: string, value: string, sub: string, valueColor: MarkColor): CardEl {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: TILE_BG[valueColor],
    padding: '8px 10px 8px 10px',
    elements: [md([`**${label}**`, colored(`**${value}**`, valueColor), colored(sub, 'grey')].join('\n'))],
  }
}

/** 参与名次的最低单量：与 shared/vendorAnalysis/rankingScore.ts 的 MIN_RATE_SAMPLE 同值，量太小的率没有可比性 */
export const MIN_RANK_SAMPLE = 30

export type Dispatch24hRankEntry = {
  /** 供应商单位键 buildSupplierUnitKey */
  key: string
  name: string
  total: number
  met: number
  /** 名次 1..N；样本不足（total < MIN_RANK_SAMPLE）为 null，排在最后、不计入 N */
  rank: number | null
}

/**
 * 同站点供应商按 24H 派签率实时排名，口径与卡片上的「24H delivery rate」完全一致（met / total）。
 * 同率时单量大的在前，再按名字，保证结果稳定。
 * 不复用 rankVendors：它把率映射成分数，≥95% 全是 100 分，头部会并列。
 */
export function rankDispatch24h(items: Array<Omit<Dispatch24hRankEntry, 'rank'>>): Dispatch24hRankEntry[] {
  const isRanked = (e: { total: number }) => e.total >= MIN_RANK_SAMPLE
  const rate = (e: { total: number; met: number }) => (e.total > 0 ? e.met / e.total : 0)
  const sorted = [...items].sort((a, b) => {
    if (isRanked(a) !== isRanked(b)) return isRanked(a) ? -1 : 1
    return rate(b) - rate(a) || b.total - a.total || a.name.localeCompare(b.name)
  })
  let next = 1
  return sorted.map((e) => ({ ...e, rank: isRanked(e) ? next++ : null }))
}

const MEDALS = ['🥇', '🥈', '🥉'] as const
/** 前三名整行底色：金 / 银 / 铜 */
const PODIUM_BG = ['yellow-50', 'grey-50', 'orange-50'] as const

function rankRate(e: Dispatch24hRankEntry): number {
  return e.total > 0 ? (e.met / e.total) * 100 : 0
}

/** 排行卡一行：整行一个色块，左侧名次 + 供应商，右侧派签率；前三名换成奖牌并铺金银铜底色 */
function rankingRow(e: Dispatch24hRankEntry, alertThresholdPct: number): CardEl {
  const rate = rankRate(e)
  const podium = e.rank != null && e.rank <= 3 ? e.rank - 1 : null
  const badge = podium != null ? MEDALS[podium] : e.rank != null ? `**${e.rank}**` : colored('·', 'grey')
  const rateText = colored(`**${rate.toFixed(1)}%**`, rate < alertThresholdPct ? 'red' : 'green')
  // 行内留白挂在每列上（column_set 不支持 padding），列间距为 0，列与列之间不露缝
  const cell = (layout: CardEl, element: CardEl): CardEl => ({
    tag: 'column',
    vertical_align: 'center',
    padding: '4px 8px 4px 8px',
    ...layout,
    elements: [element],
  })
  // 整行一块底色挂在 column_set 上，而不是每列各铺一块。
  // 不用交互容器：它的 behaviors 必填，点一下会等回调、出现 loading
  return {
    tag: 'column_set',
    flex_mode: 'none',
    horizontal_spacing: '0px',
    ...(podium != null ? { background_style: PODIUM_BG[podium] } : {}),
    columns: [
      // 名次单独一列、固定宽度居中放大，各行的奖牌/数字上下对齐
      cell({ width: '44px' }, md(badge, { text_align: 'center', text_size: 'xx-large' })),
      cell({ width: 'weighted', weight: 3 }, md(`**${e.name}**`)),
      cell({ width: 'weighted', weight: 1 }, md(rateText, { text_align: 'right' })),
    ],
  }
}

/** 实时排名卡：紧跟在每家供应商的数据卡片后发到该供应商群；同站点全部供应商实名排名，前三名金银铜，低于阈值的率标红 */
export function buildDispatchAlarmRankingCard(params: {
  /** 站点展示名（取不到时调用方传编码兜底） */
  stationName: string
  date: string
  pushTime: string
  tz: AusTz
  alertThresholdPct: number
  entries: Dispatch24hRankEntry[]
}): Record<string, unknown> {
  const { stationName, date, pushTime, tz, alertThresholdPct, entries } = params
  const ranked = entries.filter((e) => e.rank != null)
  const unranked = entries.filter((e) => e.rank == null)

  const rankingElements: CardEl[] = ranked.map((e) => rankingRow(e, alertThresholdPct))
  if (unranked.length > 0) {
    rankingElements.push(
      hr(),
      md(colored(`Not ranked (fewer than ${MIN_RANK_SAMPLE} waybills)`, 'grey'), { text_size: 'notation' }),
      ...unranked.map((e) => rankingRow(e, alertThresholdPct)),
    )
  }
  rankingElements.push(hr(), footerCaption(`${date} ${pushTime} · iMile Warehouse Management System`))

  return {
    schema: '2.0',
    header: {
      template: 'orange',
      title: { tag: 'plain_text', content: `🏆 Delivery Live Ranking · ${stationName}` },
      subtitle: {
        tag: 'plain_text',
        content: `${date} ${pushTime} (${tzDisplayName(tz)}) · Threshold ${alertThresholdPct}%`,
      },
    },
    body: { direction: 'vertical', vertical_spacing: '4px', elements: rankingElements },
  }
}

/**
 * 构建 24 小时签收率告警飞书卡片（card JSON 2.0 结构）。
 * “派签率”口径实为“24小时内签收率”（deliveryTime 起 24h 内 signDate/lastProblemDate），
 * 卡片英文措辞按“delivery/signed”表达，不用字面 dispatch。
 * 达标数据来自「供应商数据分析」封装复用出来的 aggregateDispatch24hByVendor
 * （按配置 vendorCode + routeCode 纳入 + 白名单），一条配置一张卡片；
 * 明细按司机（courierCode）汇总未达标数，而非罗列单个运单号，便于定位具体司机。
 */
export function buildDispatchAlarmCard(params: {
  vendorName: string
  date: string
  pushTime: string
  /** 计算 date/pushTime 所用的账号时区，用于卡片上的时区标签 */
  tz: AusTz
  total: number
  met: number
  /** 问题件数：见 aggregateDispatch24hByVendor 的 isDispatch24hProblem 口径；仅用于判断是否给出落地页链接，卡片不再展示 */
  problemCount: number
  /** 「本地件优先客户」包裹数 */
  priorityTotal: number
  /** 「本地件优先客户」包裹中尚未签收的件数；本次派送已上报问题件视同已签收，与 24H 派签口径一致 */
  priorityUnsigned: number
  drivers: Dispatch24hDriverStat[]
  /** 未分配司机（尚未派件）的那部分单，见 Dispatch24hVendorStat.unassigned */
  unassigned?: Dispatch24hDriverStat | null
  alertThresholdPct: number
  pushDescription?: string | null
  /** 无登录落地页：查看并复制未达标运单号 */
  detailUrl?: string | null
  /** 命中「是否 @ 相关人员」时传入，供应商配置花名册里选中的全部联系人 */
  mentions?: SupplierMentionContact[] | null
  /** 落地页按钮点击回调关联供应商用，见「推送数据监控」 */
  supplierConfigId?: string | null
}): Record<string, unknown> {
  const {
    vendorName,
    date,
    pushTime,
    tz,
    total,
    met,
    problemCount,
    priorityTotal,
    priorityUnsigned,
    drivers,
    unassigned,
    alertThresholdPct,
    pushDescription,
    detailUrl,
    mentions,
    supplierConfigId,
  } = params
  const elements: CardEl[] = []

  const unmet = total - met
  const rate = total > 0 ? (met / total) * 100 : 0
  const rateText = total > 0 ? `${rate.toFixed(1)}%` : '—'
  const isAlert = total > 0 && rate < alertThresholdPct

  elements.push(
    md(
      [
        `📮 **Responsible vendor: ${vendorName}**`,
        colored(`${date} ${pushTime} (${tzDisplayName(tz)})`, 'grey'),
        pushDescription ? colored(pushDescription, 'grey') : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  )

  elements.push(hr())

  // 三块磁贴各占一种色相，避免整行同色分不出块：率=蓝（中性指标，达标与否看标题/阈值副行）、
  // 未完成量=红、优先客户=橙；无未完成量时相应磁贴转绿表示已清完。
  elements.push(
    columnSet([
      summaryTile('24H delivery rate', rateText, `Threshold ${alertThresholdPct}%`, 'blue'),
      summaryTile('Not signed', `${unmet}`, `${total} waybills total`, unmet > 0 ? 'red' : 'green'),
      // 问题件磁贴换成「本地件优先客户」派送进度：未签收优先件 / 优先件总数
      summaryTile(
        'Priority Packages',
        `${priorityUnsigned} not signed`,
        `${priorityTotal} total`,
        priorityUnsigned > 0 ? 'orange' : 'green',
      ),
    ]),
  )

  elements.push(hr())

  const unmetDrivers = drivers.filter((d) => d.total - d.met > 0)
  const unassignedUnmet = unassigned ? unassigned.total - unassigned.met : 0
  // 结论必须按供应商级 unmet 判定：未派件的单没有 courierCode，不会出现在 drivers 里，
  // 用 unmetDrivers.length 判断会把「16 单未签收」说成「全部已签收」。
  if (unmet === 0) {
    elements.push(md(colored('✅ All waybills signed within 24H', 'green')))
  } else {
    const shown = unmetDrivers.slice(0, MAX_DRIVER_LINES)
    const lines = shown.map((d) => {
      const unmetParts: string[] = []
      if (d.neverSignedCount > 0) unmetParts.push(colored(`${d.neverSignedCount} not signed`, 'red'))
      if (d.lateSignedCount > 0) unmetParts.push(colored(`${d.lateSignedCount} signed late`, 'orange'))
      return `· **${shortDriverName(d.courierName)}** (${d.courierCode}) ${unmetParts.join(', ')} / ${d.total} total${prioritySuffix(d)}`
    })
    if (unmetDrivers.length > MAX_DRIVER_LINES) {
      lines.push(`及其他 ${unmetDrivers.length - MAX_DRIVER_LINES} 位司机`)
    }
    if (unassignedUnmet > 0) {
      lines.push(
        `· **Not dispatched (no driver assigned)** ${colored(`${unassignedUnmet} not signed`, 'red')} / ${unassigned!.total} total${prioritySuffix(unassigned!)}`,
      )
    }
    elements.push(
      md(`🚨 **Waybills not signed within 24H (${unmet})**`, {
        text_size: 'heading',
      }),
    )
    elements.push(md(lines.join('\n')))
  }

  if (detailUrl && (unmet > 0 || problemCount > 0)) {
    elements.push(hr())
    elements.push(
      openUrlButton(detailUrl, 'Click to View Details', {
        pushType: 'dispatch_alarm',
        actionType: 'view_details',
        supplierConfigId: supplierConfigId ?? '',
      }),
    )
  }

  elements.push(hr())
  elements.push(footerCaption(`${date} ${pushTime} · iMile Warehouse Management System`))

  const mentionLarkMd = buildMentionLarkMd(mentions)
  if (mentionLarkMd) {
    elements.push(md(mentionLarkMd))
  }

  return {
    schema: '2.0',
    header: {
      template: isAlert ? 'blue' : 'green',
      title: {
        tag: 'plain_text',
        content: isAlert
          ? `24-Hour Delivery Alert - ${vendorName}`
          : `24-Hour Delivery on track - ${vendorName}`,
      },
    },
    body: {
      direction: 'vertical',
      vertical_spacing: '6px',
      elements,
    },
  }
}
