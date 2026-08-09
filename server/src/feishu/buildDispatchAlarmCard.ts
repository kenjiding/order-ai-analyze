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
 * 司机名原始格式类似 "MEL-KM-8857-Yanping ZHOU"，按 "-" 分隔取最后一段展示，避免推送内容过长。
 * 仅用于飞书卡片展示，落地页保留原始全名。
 */
function shortDriverName(courierName: string): string {
  const parts = courierName.split('-')
  return parts[parts.length - 1].trim() || courierName
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
  stationCode: string
  date: string
  pushTime: string
  /** 计算 date/pushTime 所用的账号时区，用于卡片上的时区标签 */
  tz: AusTz
  total: number
  met: number
  /** 问题件数：见 aggregateDispatch24hByVendor 的 isDispatch24hProblem 口径 */
  problemCount: number
  drivers: Dispatch24hDriverStat[]
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
    stationCode,
    date,
    pushTime,
    tz,
    total,
    met,
    problemCount,
    drivers,
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
        colored(`Station: ${stationCode} · ${date} ${pushTime} (${tzDisplayName(tz)})`, 'grey'),
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
      summaryTile('Problem parcels', `${problemCount}`, `${total} waybills total`, problemCount > 0 ? 'orange' : 'green'),
    ]),
  )

  elements.push(hr())

  const unmetDrivers = drivers.filter((d) => d.total - d.met > 0)
  if (unmetDrivers.length === 0) {
    elements.push(md(colored('✅ All waybills signed within 24H', 'green')))
  } else {
    const shown = unmetDrivers.slice(0, MAX_DRIVER_LINES)
    const lines = shown.map((d) => {
      const unmetParts: string[] = []
      if (d.neverSignedCount > 0) unmetParts.push(colored(`${d.neverSignedCount} not signed`, 'red'))
      if (d.lateSignedCount > 0) unmetParts.push(colored(`${d.lateSignedCount} signed late`, 'orange'))
      const problemSuffix = d.problemCount > 0 ? `. ${colored(`${d.problemCount} problem`, 'orange')}` : ''
      return `· **${shortDriverName(d.courierName)}** (${d.courierCode}) ${unmetParts.join(', ')} / ${d.total} total${problemSuffix}`
    })
    if (unmetDrivers.length > MAX_DRIVER_LINES) {
      lines.push(`及其他 ${unmetDrivers.length - MAX_DRIVER_LINES} 位司机`)
    }
    elements.push(
      md(`🚨 **Drivers with waybills not signed within 24H (${unmetDrivers.length})**\n${lines.join('\n')}`),
    )
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
  elements.push(footerCaption(`${date} ${pushTime} · 24H delivery rate monitoring · iMile Warehouse Management System`))

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
