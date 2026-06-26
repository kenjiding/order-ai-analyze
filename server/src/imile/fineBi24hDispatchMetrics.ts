import {
  buildFineBiAuthConfig,
  invalidateFineBiShareLinkCache,
  type FineBiAuthConfig,
  postFineBiShareWidgetData,
  resolveFineBiShareLink,
} from './fineBiAuth'
import type { FineBiConnectionInput } from './fineBiTypes'
import type { VendorAnalysisError, VendorAnalysisSuccess } from './vendorAnalysis'

const TABLE_ID = 'bc06fba5deba4dc181d2d1f3a8c9ca3c'

const METRIC_DIM_IDS = {
  firstOfdCnt: '336ac361bfd0e987',
  in24hDldCnt: '34ad57556179a8c2',
  /** 24WH派签率 */
  dispatchRate24h: 'eef3cf60ad861d72',
} as const


const VIEW_METRIC_IDS = Object.values(METRIC_DIM_IDS)

const FINE_BI_DIMENSIONS = {
  [METRIC_DIM_IDS.firstOfdCnt]: {
    id: METRIC_DIM_IDS.firstOfdCnt,
    fieldId: `${TABLE_ID}_first[5f]ofd[5f]cnt`,
    type: 2,
    group: { type: 3 },
    calculation: { type: 0, value: 0 },
  },
  [METRIC_DIM_IDS.in24hDldCnt]: {
    id: METRIC_DIM_IDS.in24hDldCnt,
    fieldId: `${TABLE_ID}_in[5f]24h[5f]dld[5f]cnt`,
    type: 2,
    group: { type: 3 },
    calculation: { type: 0, value: 0 },
  },
  [METRIC_DIM_IDS.dispatchRate24h]: {
    id: METRIC_DIM_IDS.dispatchRate24h,
    fieldId: 'f5b702126dc679a3',
    type: 5,
    group: { type: 3 },
    calculation: { type: 0, value: 0 },
  },
} as const

const FINE_BI_MEASURES = [
  {
    id: 'f5b702126dc679a3',
    type: 97,
    name: '24WH派签率',
    targetIds: [
      `${TABLE_ID}_in[5f]24h[5f]dld[5f]cnt`,
      `${TABLE_ID}_first[5f]ofd[5f]cnt`,
    ],
    calculate: {
      value: `SUM_AGG(\${${TABLE_ID}_in[5f]24h[5f]dld[5f]cnt})/SUM_AGG(\${${TABLE_ID}_first[5f]ofd[5f]cnt})`,
      aggregate: true,
      type: 0,
    },
  },
  { id: `${TABLE_ID}_first[5f]ofd[5f]cnt`, type: 32 },
  { id: `${TABLE_ID}_in[5f]24h[5f]dld[5f]cnt`, type: 32 },
] as const

export type FineBi24hDispatchMetricsParams = {
  startDate: string
  endDate: string
  vendorCode: string
  stationCodes: string[]
  country?: string
  connection: FineBiConnectionInput
}

export type FineBi24hDispatchMetrics = {
  firstOfdCnt: number
  in24hDldCnt: number
  /** 24WH派签率，取自 items[0].values 中对应 dId 的 formatText */
  dispatchRate24hText: string
  /** 24小时签收未达标 = 首派单量 - 24WH签收单量 */
  notMet24hSignCount: number
}

type FineBiValueCell = {
  dId?: string
  text?: string | null
  formatText?: string | null
}

function formatStationCodeCtrlQd(stationCodes: string[]): string {
  return stationCodes.map((s) => s.trim()).filter(Boolean).join("','")
}

function buildFineBiRequestBody(params: FineBi24hDispatchMetricsParams): Record<string, unknown> {
  const stationValue = formatStationCodeCtrlQd(params.stationCodes)
  const country = params.country?.trim() || 'AUS'
  return {
    tableName: [TABLE_ID],
    view: { 30000: VIEW_METRIC_IDS },
    dimensions: FINE_BI_DIMENSIONS,
    measures: FINE_BI_MEASURES,
    queryInfo: {
      parameter: {
        country_ctrl: { type: 97, value: country },
        start_date_ctrl: { type: 97, value: params.startDate },
        end_date_ctrl: { type: 97, value: params.endDate },
        station_code_ctrl_qd: { type: 97, value: stationValue },
        vendor_code_ctrl: { type: 97, value: params.vendorCode },
        region_ctrl: { type: 97, value: '' },
        station_ctrl: { type: 97, value: '' },
        client_code_ctrl: { type: 97, value: '' },
        date_type_ctrl: { type: 97, value: 'first_ofd' },
      },
    },
  }
}

function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function readCountValue(values: FineBiValueCell[], dId: string): number | null {
  const cell = values.find((v) => v.dId === dId)
  if (!cell) return null
  return parseNumber(cell.text) ?? parseNumber(cell.formatText?.replace(/,/g, ''))
}

function readDispatchRateFormatText(values: FineBiValueCell[], dId: string): string | null {
  const cell = values.find((v) => v.dId === dId)
  if (!cell) return null
  // FineBI type:5 dimension cells store the raw decimal in `text` (e.g. "0.9578")
  // but round it to 2 dp in `formatText` (e.g. "0.96"). Build the percentage from `text`.
  const rawVal = parseNumber(cell.text)
  if (rawVal != null && rawVal >= 0 && rawVal <= 1) {
    return `${(rawVal * 100).toFixed(2)}%`
  }
  // Fallback: formatText when text is absent or already > 1
  const formatText = cell.formatText?.trim()
  return formatText || null
}

type ParseResult =
  | { kind: 'ok'; metrics: FineBi24hDispatchMetrics }
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
  const firstOfdCnt = readCountValue(cells, METRIC_DIM_IDS.firstOfdCnt)
  const in24hDldCnt = readCountValue(cells, METRIC_DIM_IDS.in24hDldCnt)
  const dispatchRate24hText = readDispatchRateFormatText(cells, METRIC_DIM_IDS.dispatchRate24h)

  if (firstOfdCnt == null || in24hDldCnt == null || dispatchRate24hText == null) {
    return { kind: 'error', message: 'FineBI 指标字段缺失（dId 配置不匹配）' }
  }

  return {
    kind: 'ok',
    metrics: { firstOfdCnt, in24hDldCnt, dispatchRate24hText, notMet24hSignCount: firstOfdCnt - in24hDldCnt },
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

export async function fetchFineBi24hDispatchMetrics(
  params: FineBi24hDispatchMetricsParams,
): Promise<VendorAnalysisSuccess<FineBi24hDispatchMetrics | null> | VendorAnalysisError> {
  if (!params.startDate?.trim()) {
    return { ok: false, status: 400, message: '缺少 startDate' }
  }
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
      message: '缺少 FineBI 公共链接 link：请在 FineBI 连接配置中填写 shareLink',
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

export async function fetchFineBi24hDispatchMetricsBatch(params: {
  startDate: string
  endDate: string
  vendorCodes: string[]
  stationCodes: string[]
  country?: string
  connection: FineBiConnectionInput
}): Promise<VendorAnalysisSuccess<Record<string, FineBi24hDispatchMetrics>> | VendorAnalysisError> {
  const uniqueCodes = [...new Set(params.vendorCodes.map((c) => c.trim()).filter(Boolean))]
  if (!uniqueCodes.length) {
    return { ok: true, data: {} }
  }

  const entries = await Promise.all(
    uniqueCodes.map(async (vendorCode) => {
      const result = await fetchFineBi24hDispatchMetrics({
        startDate: params.startDate,
        endDate: params.endDate,
        vendorCode,
        stationCodes: params.stationCodes,
        country: params.country,
        connection: params.connection,
      })
      return [vendorCode, result] as const
    }),
  )

  const data: Record<string, FineBi24hDispatchMetrics> = {}
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
    console.warn('[FineBI] 部分供应商 24WH 派签率拉取出错:', errors.join('；'))
  }

  return { ok: true, data }
}
