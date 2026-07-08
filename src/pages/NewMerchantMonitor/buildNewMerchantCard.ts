/**
 * 构建新商家数据监控的飞书交互式卡片消息（webhook v1 卡片）。
 *
 * 飞书卡片 lark_md 不支持 #/##/### 标题，因此用 **加粗** + emoji 段分。
 * 用 column_set + flex_mode=bisect/trisect/flow 实现"色块磁贴"风格 KPI。
 * 用 █░ unicode 块字符绘制进度条。
 */

import {
  formatCount,
  formatDays,
  formatPercent,
  type KpiSummary,
  type RouteCodeRow,
  type TransitBucket,
} from './metrics'

type FeishuCardElement = Record<string, unknown>
type FeishuMarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue'

/**
 * 飞书 webhook v1 卡片 column.background_style 实际能稳定渲染、且不与黑字冲突的浅色仅 `grey` / `default`。
 * 其余模板色（red/green/orange/turquoise/wathet 等）饱和度太高，前景字看不清。
 * 配色信息改由前置 emoji 色块（🟢🟠🔴🔵⚪）+ <font color> 文字染色承担。
 */
type FeishuTileBg = 'default' | 'grey'

const TURQUOISE = 'turquoise'
const RED = 'red'
const ORANGE = 'orange'

const BAR_FULL = '█'
const BAR_EMPTY = '░'

function makeBar(percent: number, segments = 12): string {
  if (!Number.isFinite(percent) || percent <= 0) return BAR_EMPTY.repeat(segments)
  const filled = Math.min(segments, Math.max(0, Math.round((percent / 100) * segments)))
  return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(segments - filled)
}

function div(content: string): FeishuCardElement {
  return { tag: 'div', text: { tag: 'lark_md', content } }
}

function hr(): FeishuCardElement {
  return { tag: 'hr' }
}

function note(content: string): FeishuCardElement {
  return { tag: 'note', elements: [{ tag: 'lark_md', content }] }
}

function colored(value: string, color: FeishuMarkColor): string {
  return `<font color='${color}'>${value}</font>`
}

/** 创建带背景的 column_set 色块栅格。每个 column 是一个色块磁贴。 */
function columnSet(
  columns: FeishuCardElement[],
  options: {
    flexMode?: 'bisect' | 'trisect' | 'flow' | 'stretch'
    backgroundStyle?: 'default' | 'grey'
    horizontalSpacing?: 'default' | 'small'
  } = {},
): FeishuCardElement {
  return {
    tag: 'column_set',
    flex_mode: options.flexMode ?? 'bisect',
    background_style: options.backgroundStyle ?? 'default',
    horizontal_spacing: options.horizontalSpacing ?? 'default',
    columns,
  }
}

/**
 * 单个 KPI 色块磁贴 = 一个有 background_style 的 `column`：
 *   emoji 色块 + 标签 + 大字号数值 + 副标。
 * 背景色由调用方决定（按指标语义/达标状态映射）。
 */
function kpiTile({
  swatch,
  label,
  value,
  sub,
  valueColor,
  bg,
}: {
  swatch: string
  label: string
  value: string
  sub?: string
  valueColor: FeishuMarkColor
  bg: FeishuTileBg
}): FeishuCardElement {
  const lines: string[] = [
    `${swatch} **${label}**`,
    colored(`**${value}**`, valueColor),
  ]
  if (sub) lines.push(colored(sub, 'grey'))
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: bg,
    elements: [div(lines.join('\n'))],
  }
}

/** 统一浅灰底，让色块磁贴整齐又不抢字 */
const TILE_BG: FeishuTileBg = 'grey'

function describeRateColor(
  rate: number | null,
  good: number,
  warn: number,
): { color: FeishuMarkColor; swatch: string } {
  if (rate === null) return { color: 'grey', swatch: '⚪' }
  if (rate >= good) return { color: 'green', swatch: '🟢' }
  if (rate >= warn) return { color: 'orange', swatch: '🟠' }
  return { color: 'red', swatch: '🔴' }
}

function describeTransitColor(percent: number, label: string): FeishuMarkColor {
  if (label === '>4D') return percent > 10 ? 'red' : 'orange'
  if (label === '4D') return percent > 30 ? 'orange' : 'green'
  return 'green'
}

export type BuildNewMerchantCardInput = {
  title: string
  clientCodes: string[]
  windowLabel: string
  generatedAt: string
  metrics: KpiSummary
  transitDistribution: TransitBucket[]
  routeCodeRows: RouteCodeRow[]
}

export function buildNewMerchantCard(input: BuildNewMerchantCardInput): Record<string, unknown> {
  const {
    title,
    clientCodes,
    windowLabel,
    generatedAt,
    metrics,
    transitDistribution,
    routeCodeRows,
  } = input

  const summary = {
    bad: routeCodeRows.filter((r) => r.status === 'bad').length,
    warning: routeCodeRows.filter((r) => r.status === 'warning').length,
    ok: routeCodeRows.filter((r) => r.status === 'ok').length,
    insufficient: routeCodeRows.filter((r) => r.status === 'insufficient').length,
  }
  const topBad = routeCodeRows.filter((r) => r.status === 'bad').slice(0, 5)
  const topWarning = routeCodeRows.filter((r) => r.status === 'warning').slice(0, 5)

  // 标题色：差则红、有警则橙、全好则青绿
  const headerTemplate =
    summary.bad > 0 ? RED : summary.warning > 0 ? ORANGE : TURQUOISE

  // ── header subtitle ──
  const headerTitle = clientCodes.length
    ? `${title} · ${clientCodes.slice(0, 3).join('/')}${clientCodes.length > 3 ? '…' : ''}`
    : title

  const elements: FeishuCardElement[] = []

  // ── 顶部信息区 ──
  const clientCodesLine = clientCodes.length
    ? clientCodes.map((c) => `${c}`).join(' · ')
    : '_未指定_'
  elements.push(
    div(
      [
        `📦 **新商家**：${title} - ${clientCodesLine}`,
        `🗓 **统计窗口**：${windowLabel || '--'}`,
        `⏱ **生成时间**：${generatedAt}`,
      ].join('\n'),
    ),
  )

  elements.push(hr())

  // ── 核心指标小节标题 ──
  elements.push(div('📊 **核心指标**'))

  // 签收率 / 24h派签率 双色块（按达标状态染色）
  const signMeta = describeRateColor(metrics.signRate, 0.95, 0.85)
  const within24Meta = describeRateColor(metrics.within24hRate, 0.6, 0.4)
  elements.push(
    columnSet(
      [
        kpiTile({
          swatch: signMeta.swatch,
          label: '签收率',
          value: formatPercent(metrics.signRate),
          sub: `${formatCount(metrics.signedCount)} / ${formatCount(metrics.totalCount)}`,
          valueColor: signMeta.color,
          bg: TILE_BG,
        }),
        kpiTile({
          swatch: within24Meta.swatch,
          label: '24h派签率',
          value: formatPercent(metrics.within24hRate),
          sub: `${formatCount(metrics.within24hCount)} / ${formatCount(metrics.dispatchedCount)}（已派送）`,
          valueColor: within24Meta.color,
          bg: TILE_BG,
        }),
      ],
      { flexMode: 'bisect' },
    ),
  )

  // 总货量 / 到达DS货量 双色块
  elements.push(
    columnSet(
      [
        kpiTile({
          swatch: '🟢',
          label: '总货量',
          value: `${formatCount(metrics.totalCount)} 单`,
          sub: '查询窗口内 firstCountryDate',
          valueColor: 'green',
          bg: TILE_BG,
        }),
        kpiTile({
          swatch: '🔵',
          label: '到达DS货量',
          value: `${formatCount(metrics.dsArriveCount)} 单`,
          sub: `${formatPercent(metrics.dsArriveRate)} 占总货量`,
          valueColor: 'blue',
          bg: TILE_BG,
        }),
      ],
      { flexMode: 'bisect' },
    ),
  )

  // Melbourne 2D / Sydney 3D 双色块（按达标状态染色，无数据 = 灰）
  const mel = metrics.melbourne2D
  const syd = metrics.sydney3D
  const melMeta =
    mel.subsetTotal === 0
      ? { color: 'grey' as const, swatch: '⚪' }
      : describeRateColor(mel.rate, 0.9, 0.75)
  const sydMeta =
    syd.subsetTotal === 0
      ? { color: 'grey' as const, swatch: '⚪' }
      : describeRateColor(syd.rate, 0.9, 0.75)
  elements.push(
    columnSet(
      [
        kpiTile({
          swatch: melMeta.swatch,
          label: 'Melbourne · 2D',
          value: mel.subsetTotal === 0 ? '无数据' : formatPercent(mel.rate),
          sub:
            mel.subsetTotal === 0
              ? '该窗口无 Melbourne Center 单'
              : `${formatCount(mel.matched)} / ${formatCount(mel.subsetTotal)}`,
          valueColor: melMeta.color,
          bg: TILE_BG,
        }),
        kpiTile({
          swatch: sydMeta.swatch,
          label: 'Sydney · 3D',
          value: syd.subsetTotal === 0 ? '无数据' : formatPercent(syd.rate),
          sub:
            syd.subsetTotal === 0
              ? '该窗口无 Sydney Center 单'
              : `${formatCount(syd.matched)} / ${formatCount(syd.subsetTotal)}`,
          valueColor: sydMeta.color,
          bg: TILE_BG,
        }),
      ],
      { flexMode: 'bisect' },
    ),
  )

  elements.push(hr())

  // ── 转运时间分布 ──
  elements.push(div('⏳ **转运到达ds的时间分布**'))
  const transitLines = transitDistribution
    .map((b) => {
      const color = describeTransitColor(b.percent, b.label)
      const bar = makeBar(b.percent)
      const labelPadded = b.label.padEnd(4, ' ')
      const pctStr = `${b.percent.toFixed(1)}%`
      return `${labelPadded} ${bar} ${colored(pctStr, color)} <font color='grey'>(${formatCount(b.count)})</font>`
    })
    .join('\n')
  elements.push(div(transitLines))
  elements.push(hr())

  // ── 路由码达标分析 ──
  elements.push(div('🛣 **路由码达标分析**'))

  // 4 状态色块栅格
  const statusColumn = (
    swatch: string,
    label: string,
    count: number,
    color: FeishuMarkColor,
    bg: FeishuTileBg,
  ): FeishuCardElement => ({
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: bg,
    elements: [
      div(`${swatch} **${label}**\n${colored(`**${count}**`, color)} <font color='grey'>条</font>`),
    ],
  })

  elements.push(
    columnSet(
      [
        statusColumn('🔴', '不达标', summary.bad, 'red', TILE_BG),
        statusColumn('🟠', '警告', summary.warning, 'orange', TILE_BG),
        statusColumn('🟢', '达标', summary.ok, 'green', TILE_BG),
        statusColumn('⚪', '样本不足', summary.insufficient, 'grey', TILE_BG),
      ],
      { flexMode: 'flow', horizontalSpacing: 'small' },
    ),
  )

  // 重点列出 bad 或 warning（按优先级）
  if (topBad.length) {
    elements.push(
      div(`${colored('**⚠ 不达标 Top ' + topBad.length + '**', 'red')}\n${renderRouteList(topBad, 'red')}`),
    )
  } else if (topWarning.length) {
    elements.push(
      div(
        `${colored('**⚠ 警告 Top ' + topWarning.length + '**', 'orange')}\n${renderRouteList(topWarning, 'orange')}`,
      ),
    )
  } else {
    elements.push(
      div(colored('✅ **全部路由码达标，未发现明显问题。**', 'green')),
    )
  }

  elements.push(hr())
  elements.push(note('by 仓库管理 · 新商家数据监控'))

  return {
    config: { wide_screen_mode: true },
    header: {
      template: headerTemplate,
      title: { tag: 'plain_text', content: headerTitle },
    },
    elements,
  }
}

function renderRouteList(rows: RouteCodeRow[], emphasis: 'red' | 'orange'): string {
  return rows
    .map((r, idx) => {
      const head = `**${idx + 1}. ${r.routeCode}** ｜ 货量 ${formatCount(r.volume)}`
      const kpiLine = `签收 ${colored(formatPercent(r.signRate), emphasis)} ｜ 24h派签率 ${colored(
        formatPercent(r.within24hRate),
        emphasis,
      )} ｜ 中位转运 ${colored(formatDays(r.medianTransitDays), emphasis)}`
      const vendorLine = r.topVendor ? `派件供应商：${r.topVendor}` : ''
      const violationLine = r.violations.length
        ? colored(`⚠ ${r.violations.join(' · ')}`, emphasis)
        : ''
      return [head, kpiLine, vendorLine, violationLine].filter(Boolean).join('\n')
    })
    .join('\n\n')
}
