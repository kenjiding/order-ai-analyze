import {
  buildFineBiAuthConfig,
  invalidateFineBiShareLinkCache,
  type FineBiAuthConfig,
  postFineBiShareWidgetData,
  resolveFineBiShareLink,
} from './fineBiAuth'
import type { FineBiConnectionInput } from './fineBiTypes'
import type { VendorAnalysisError, VendorAnalysisSuccess } from './vendorAnalysis'

const TABLE_ID = '96a7d3f11ad74a4a9290b1de2664b721'

/** FineBI 汇总行指标列 dId */
const METRIC_DIM_IDS = {
  inboundVolume: 'd5f6e96e2bdbce62',
  pickupVolume: '8bf764c951aab5c4',
  pickupRate: '892e26fc63feda53',
  onTimePickupVolume: '3b02dda3cf001144',
  /** 准时提货率，业务侧称「11点前出仓率」 */
  before11ExitRate: 'a2e3e14dcd02907d',
} as const

const VIEW_METRIC_IDS = Object.values(METRIC_DIM_IDS)

const FINE_BI_DIMENSIONS = {
  [METRIC_DIM_IDS.inboundVolume]: {
    id: METRIC_DIM_IDS.inboundVolume,
    fieldId: `${TABLE_ID}_first[5f]ofd[5f]station[5f]inbound[5f]volume`,
    type: 2,
    group: { type: 3 },
    calculation: { type: 0, value: 0 },
  },
  [METRIC_DIM_IDS.pickupVolume]: {
    id: METRIC_DIM_IDS.pickupVolume,
    fieldId: `${TABLE_ID}_first[5f]ofd[5f]station[5f]fofd[5f]volume`,
    type: 2,
    group: { type: 3 },
    calculation: { type: 0, value: 0 },
  },
  [METRIC_DIM_IDS.pickupRate]: {
    id: METRIC_DIM_IDS.pickupRate,
    fieldId: '99568c938fda8ab2',
    type: 5,
    group: { type: 3 },
    calculation: { type: 0, value: 0 },
  },
  [METRIC_DIM_IDS.onTimePickupVolume]: {
    id: METRIC_DIM_IDS.onTimePickupVolume,
    fieldId: `${TABLE_ID}_pickup[5f]ontime[5f]volume`,
    type: 2,
    group: { type: 3 },
    calculation: { type: 0, value: 0 },
  },
  [METRIC_DIM_IDS.before11ExitRate]: {
    id: METRIC_DIM_IDS.before11ExitRate,
    fieldId: '7e817db67fa8527d',
    type: 5,
    group: { type: 3 },
    calculation: { type: 0, value: 0 },
  },
} as const

const FINE_BI_MEASURES = [
  {
    id: '99568c938fda8ab2',
    type: 97,
    name: '提货率',
    targetIds: [
      `${TABLE_ID}_first[5f]ofd[5f]station[5f]fofd[5f]volume`,
      `${TABLE_ID}_first[5f]ofd[5f]station[5f]inbound[5f]volume`,
    ],
    calculate: {
      value: `SUM_AGG(\${${TABLE_ID}_first[5f]ofd[5f]station[5f]fofd[5f]volume})/SUM_AGG(\${${TABLE_ID}_first[5f]ofd[5f]station[5f]inbound[5f]volume})`,
      aggregate: true,
      type: 0,
    },
  },
  {
    id: '7e817db67fa8527d',
    type: 97,
    name: '提货率',
    targetIds: [
      `${TABLE_ID}_first[5f]ofd[5f]station[5f]inbound[5f]volume`,
      `${TABLE_ID}_pickup[5f]ontime[5f]volume`,
    ],
    calculate: {
      value: `SUM_AGG(\${${TABLE_ID}_pickup[5f]ontime[5f]volume})/SUM_AGG(\${${TABLE_ID}_first[5f]ofd[5f]station[5f]inbound[5f]volume})`,
      aggregate: true,
      type: 0,
    },
  },
  { id: `${TABLE_ID}_first[5f]ofd[5f]station[5f]inbound[5f]volume`, type: 32 },
  { id: `${TABLE_ID}_first[5f]ofd[5f]station[5f]fofd[5f]volume`, type: 32 },
  { id: `${TABLE_ID}_pickup[5f]ontime[5f]volume`, type: 32 },
] as const

export type FineBiVendorMetricsParams = {
  endDate: string
  vendorCode: string
  stationCodes: string[]
  connection: FineBiConnectionInput
}

export type FineBiVendorMetrics = {
  inboundVolume: number
  pickupVolume: number
  pickupRate: number
  onTimePickupVolume: number
  /** 11点前出仓率（FineBI：准时提货率） */
  before11ExitRate: number
}

type FineBiValueCell = {
  dId?: string
  text?: string | null
  formatText?: string | null
}

function formatStationCtrlValue(stationCodes: string[]): string {
  return stationCodes.map((s) => s.trim()).filter(Boolean).join("','")
}

function buildFineBiRequestBody(params: FineBiVendorMetricsParams): Record<string, unknown> {
  const stationValue = formatStationCtrlValue(params.stationCodes)
  return {
    tableName: [TABLE_ID],
    view: { 30000: VIEW_METRIC_IDS },
    dimensions: FINE_BI_DIMENSIONS,
    measures: FINE_BI_MEASURES,
    queryInfo: {
      parameter: {
        end_date_ctrl: { type: 97, value: params.endDate },
        vendor_code_ctrl: { type: 97, value: params.vendorCode },
        station_ctrl: { type: 97, value: stationValue },
      },
    },
  }
}

function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function readMetricValue(values: FineBiValueCell[], dId: string): number | null {
  const cell = values.find((v) => v.dId === dId)
  if (!cell) return null
  return parseNumber(cell.text) ?? parseNumber(cell.formatText)
}

type ParseResult =
  | { kind: 'ok'; metrics: FineBiVendorMetrics }
  | { kind: 'no_data' }
  | { kind: 'error'; message: string }

function parseFineBiMetrics(json: unknown): ParseResult {
  if (!json || typeof json !== 'object') return { kind: 'error', message: 'FineBI 返回非 JSON' }
  const root = json as Record<string, unknown>

  if (root.success !== true) {
    const msg = root.errorMsg ?? root.message
    return { kind: 'error', message: typeof msg === 'string' && msg.trim() ? msg : 'FineBI 查询失败' }
  }

  const data = root.data
  if (!data || typeof data !== 'object') return { kind: 'error', message: 'FineBI 返回数据格式异常' }
  const items = (data as Record<string, unknown>).items
  if (!Array.isArray(items)) return { kind: 'error', message: 'FineBI 返回数据格式异常' }

  // success:true 但无行 → 该供应商本期间无数据，正常情况
  if (items.length === 0) return { kind: 'no_data' }

  const first = items[0]
  if (!first || typeof first !== 'object') return { kind: 'error', message: 'FineBI 数据行格式异常' }
  const values = (first as Record<string, unknown>).values
  if (!Array.isArray(values)) return { kind: 'error', message: 'FineBI 数据行格式异常' }

  const cells = values as FineBiValueCell[]
  const inboundVolume = readMetricValue(cells, METRIC_DIM_IDS.inboundVolume)
  const pickupVolume = readMetricValue(cells, METRIC_DIM_IDS.pickupVolume)
  const pickupRate = readMetricValue(cells, METRIC_DIM_IDS.pickupRate)
  const onTimePickupVolume = readMetricValue(cells, METRIC_DIM_IDS.onTimePickupVolume)
  const before11ExitRate = readMetricValue(cells, METRIC_DIM_IDS.before11ExitRate)

  if (
    inboundVolume == null ||
    pickupVolume == null ||
    pickupRate == null ||
    onTimePickupVolume == null ||
    before11ExitRate == null
  ) {
    return { kind: 'error', message: 'FineBI 指标字段缺失（dId 配置不匹配）' }
  }

  return {
    kind: 'ok',
    metrics: { inboundVolume, pickupVolume, pickupRate, onTimePickupVolume, before11ExitRate },
  }
}

async function resolveShareLinkForRequest(
  config: FineBiAuthConfig,
  refresh: boolean,
): Promise<string | null> {
  if (!refresh && config.shareLink) return config.shareLink
  if (refresh) invalidateFineBiShareLinkCache()
  const resolved = await resolveFineBiShareLink(config)
  return resolved ?? config.shareLink
}

export async function fetchFineBiVendorMetrics(
  params: FineBiVendorMetricsParams,
): Promise<VendorAnalysisSuccess<FineBiVendorMetrics | null> | VendorAnalysisError> {
  if (!params.endDate?.trim()) {
    return { ok: false, status: 400, message: '缺少 endDate' }
  }
  if (!params.vendorCode?.trim()) {
    return { ok: false, status: 400, message: '缺少 vendorCode' }
  }
  if (!params.stationCodes.length) {
    return { ok: false, status: 400, message: '缺少 stationCodes' }
  }

  const configResult = buildFineBiAuthConfig(params.connection)
  if ('error' in configResult) {
    return { ok: false, status: 400, message: configResult.error }
  }

  const body = buildFineBiRequestBody(params)
  let shareLink = await resolveShareLinkForRequest(configResult, false)
  if (!shareLink) {
    return {
      ok: false,
      status: 500,
      message:
        '缺少 FineBI 公共链接 link：请配置 FINEBI_VENDOR_SHARE_LINK（可从浏览器 widget/data 请求抓取）；有 FINEBI_AUTH_TOKEN 时可尝试 API 自动刷新',
    }
  }

  let result = await postFineBiShareWidgetData(configResult, body, shareLink)
  if (!result.ok) {
    const refreshedLink = await resolveShareLinkForRequest(configResult, true)
    if (refreshedLink && refreshedLink !== shareLink) {
      shareLink = refreshedLink
      result = await postFineBiShareWidgetData(configResult, body, shareLink)
    }
  }

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      message: result.message,
      rawText: result.rawText,
    }
  }

  const parsed = parseFineBiMetrics(result.json)
  if (parsed.kind === 'no_data') return { ok: true, data: null }
  if (parsed.kind === 'error') {
    return { ok: false, status: 502, message: parsed.message, rawText: JSON.stringify(result.json).slice(0, 500) }
  }
  return { ok: true, data: parsed.metrics }
}

export async function fetchFineBiVendorMetricsBatch(params: {
  endDate: string
  vendorCodes: string[]
  stationCodes: string[]
  connection: FineBiConnectionInput
}): Promise<VendorAnalysisSuccess<Record<string, FineBiVendorMetrics>> | VendorAnalysisError> {
  const uniqueCodes = [...new Set(params.vendorCodes.map((c) => c.trim()).filter(Boolean))]
  if (!uniqueCodes.length) {
    return { ok: true, data: {} }
  }

  const entries = await Promise.all(
    uniqueCodes.map(async (vendorCode) => {
      const result = await fetchFineBiVendorMetrics({
        endDate: params.endDate,
        vendorCode,
        stationCodes: params.stationCodes,
        connection: params.connection,
      })
      return [vendorCode, result] as const
    }),
  )

  const data: Record<string, FineBiVendorMetrics> = {}
  const errors: string[] = []

  for (const [vendorCode, result] of entries) {
    if (result.ok) {
      if (result.data !== null) data[vendorCode] = result.data
      // result.data === null 表示该供应商本期无数据，静默跳过
    } else {
      errors.push(`${vendorCode}: ${result.message}`)
    }
  }

  if (errors.length) {
    console.warn('[FineBI] 部分供应商出仓率拉取出错:', errors.join('；'))
  }

  return { ok: true, data }
}

