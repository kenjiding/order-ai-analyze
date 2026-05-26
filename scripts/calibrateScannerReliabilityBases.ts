/**
 * 一次性校准：读取到件 Excel，沿用页面解析 / 会话 / 一级分拣口径，
 * 在剔除 System、ADL-shigong8 及「整月总扫描量 < 200」的扫描员后，
 * 对人-日的扫描量与有效工时做分位数，建议 reliability 基准常数。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dedupeParsedScanRowsByWaybill, buildScannerEfficiency } from '../src/pages/ScannerEfficiency/aggregates'
import { DEFAULT_SETTINGS } from '../src/pages/ScannerEfficiency/constants'
import { parseScanFileBuffer } from '../src/pages/ScannerEfficiency/bufferParsers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const FILES = [
  join(repoRoot, 'temp', '到件扫描 (4:1-4:15).xlsx'),
  join(repoRoot, 'temp', '到件扫描 (4:15-4:30).xlsx'),
]

const MIN_MONTHLY_SCANS_PER_SCANNER = 200

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step
}

function main() {
  let all: ReturnType<typeof parseScanFileBuffer>['rows'] = []
  let dropped = 0
  for (const path of FILES) {
    const buf = readFileSync(path)
    const { rows, droppedRows } = parseScanFileBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path)
    all = all.concat(rows)
    dropped += droppedRows
  }

  const { rows: deduped, duplicateDropped } = dedupeParsedScanRowsByWaybill(all)
  const result = buildScannerEfficiency(deduped, { ...DEFAULT_SETTINGS })

  if (!result) {
    console.error('无法形成一级分拣结果（检查是否含 扫描时间/运单号/扫描员 列）。')
    process.exit(1)
  }

  const keptScanners = new Set(
    result.scannerTotalRows.filter((r) => r.scanCount >= MIN_MONTHLY_SCANS_PER_SCANNER).map((r) => r.scanner),
  )
  const droppedScanners = result.scannerTotalRows.filter((r) => r.scanCount < MIN_MONTHLY_SCANS_PER_SCANNER)

  const dayRows = result.dailyScannerRows.filter((r) => keptScanners.has(r.scanner))
  const scans = dayRows.map((r) => r.scanCount).sort((a, b) => a - b)
  const hours = dayRows.map((r) => r.effectiveHours).sort((a, b) => a - b)

  const p25s = quantile(scans, 0.25)
  const p50s = quantile(scans, 0.5)
  const p75s = quantile(scans, 0.75)
  const p25h = quantile(hours, 0.25)
  const p50h = quantile(hours, 0.5)
  const p75h = quantile(hours, 0.75)

  const suggestScan = p50s != null ? Math.max(100, roundToNearest(p50s, 50)) : null
  const suggestHours = p50h != null ? Math.round(p50h * 4) / 4 : null

  console.log('=== 数据与过滤 ===')
  console.log('文件:', FILES.map((f) => f.replace(repoRoot + '/', '')).join(', '))
  console.log('解析行数(合并):', all.length, '去重前无效/剔除行:', dropped)
  console.log('运单去重后行数:', deduped.length, '重复剔除:', duplicateDropped)
  console.log('一级分拣有效行(内部):', result.summary.totalScanCount, '人-日条数(全量):', result.dailyScannerRows.length)
  console.log('整月总扫描 <', MIN_MONTHLY_SCANS_PER_SCANNER, '的扫描员数:', droppedScanners.length)
  console.log('保留扫描员数:', keptScanners.size)
  console.log('用于分位数的人-日条数:', dayRows.length)

  console.log('\n=== 人-日 扫描量 分位数（票）===')
  console.log('P25:', p25s?.toFixed(0), 'P50:', p50s?.toFixed(0), 'P75:', p75s?.toFixed(0))
  console.log('\n=== 人-日 一级分拣有效工时 分位数（小时，与页面会话规则一致）===')
  console.log('P25:', p25h?.toFixed(3), 'P50:', p50h?.toFixed(3), 'P75:', p75h?.toFixed(3))

  console.log('\n=== 建议写入 aggregates.ts 的常数（基于 P50，并做工程取整）===')
  console.log('SCANNER_RELIABILITY_BASE_SCAN_COUNT =', suggestScan)
  console.log('SCANNER_RELIABILITY_BASE_EFFECTIVE_HOURS =', suggestHours)

  if (droppedScanners.length && droppedScanners.length <= 30) {
    console.log('\n（总扫描<200 已剔除）扫描员示例:', droppedScanners.map((r) => `${r.scanner}:${r.scanCount}`).join(', '))
  }
}

main()
