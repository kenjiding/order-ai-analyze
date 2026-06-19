import { Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table/interface'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart2,
  CheckCircle2,
  Clock,
  Cpu,
  Lightbulb,
  Package,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { AdminDrawer } from '../../components/Drawer/AdminDrawer'
import {
  type EfficiencyAiAnalysis,
  type EfficiencyInsightAiProvider,
  generateCompareInsight,
} from '../ScannerEfficiency/efficiencyInsightApi'
import { formatNumber } from '../ScannerEfficiency/formatAndParse'
import {
  buildDaySnapshots,
  computeCompareAnalysis,
  type CompareAnalysisResult,
  type DayMetrics,
  type RootCauseFactor,
} from './compareAnalysis'
import type { EfficiencyAttendanceDayRecord } from '../ScannerEfficiency/dailyEfficiencyRecordSnapshot'

type Props = {
  open: boolean
  onClose: () => void
  records: EfficiencyAttendanceDayRecord[]
}

// ─── 颜色常量 ──────────────────────────────────────────────────────────────────
const C_ACCENT = '#2f8f87'
const C_ACCENT_SOFT = '#e1f5f1'
const C_RED = '#ef4444'
const C_RED_SOFT = '#fef2f2'
const C_BLUE = '#3b82f6'
const C_GRAY = '#94a3b8'

const FACTOR_ICONS: Record<RootCauseFactor, React.ReactNode> = {
  volume: <Package className="h-4 w-4" />,
  hoursPerPerson: <Clock className="h-4 w-4" />,
  cainiaoShare: <TrendingDown className="h-4 w-4" />,
  personalEfficiency: <Users className="h-4 w-4" />,
  frontDeskRatio: <Users className="h-4 w-4" />,
}

const AI_PROVIDER_OPTIONS: { value: EfficiencyInsightAiProvider; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI' },
]

// ─── 工具函数 ──────────────────────────────────────────────────────────────────
function fmtEff(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${formatNumber(n, 2)}`
}
function fmtHours(n: number): string {
  return formatNumber(n, 2) + 'h'
}
function fmtPct(n: number): string {
  return `${formatNumber(n * 100, 1)}%`
}
function fmtNum(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return formatNumber(n, 0)
}

// ─── 区块 A：效率总览（纯 CSS 水平对比条形图）────────────────────────────────
const METRICS = [
  { key: 'dayEfficiency' as const, label: '日效率', color: C_ACCENT },
  { key: 'openEfficiency' as const, label: '开仓效率', color: C_BLUE },
  { key: 'overallEfficiency' as const, label: '总体效率', color: C_GRAY },
]

function EfficiencyChart({ result }: { result: CompareAnalysisResult }) {
  // 找各指标最大值，用于按比例绘制条形宽度
  const maxEff = useMemo(() => {
    let max = 0
    for (const d of result.dayMetrics) {
      for (const m of METRICS) {
        const v = d[m.key]
        if (v != null && v > max) max = v
      }
    }
    return max || 1
  }, [result])

  return (
    <div>
      {/* 图例 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
        {METRICS.map((m) => (
          <span key={m.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: m.color }} />
            {m.label}
          </span>
        ))}
        <span className="ml-2">
          <span className="font-semibold" style={{ color: C_ACCENT }}>▲ {result.bestDate}</span> 效率最高
        </span>
        <span>
          <span className="font-semibold text-red-500">▼ {result.worstDate}</span> 效率最低
        </span>
        {result.efficiencyGapPct > 0 && (
          <span>差距 <span className="font-semibold tabular-nums text-slate-700">{formatNumber(result.efficiencyGapPct, 1)}%</span></span>
        )}
      </div>

      {/* 每天一组条形 */}
      <div className="space-y-4">
        {result.dayMetrics.map((d) => (
          <div key={d.date}>
            {/* 日期标签行 */}
            <div className="mb-1.5 flex items-center gap-2">
              <span className={[
                'min-w-[88px] text-sm font-semibold tabular-nums',
                d.isBest ? 'text-[#1f6f68]' : d.isWorst ? 'text-red-600' : 'text-slate-700',
              ].join(' ')}>
                {d.isBest ? '▲ ' : d.isWorst ? '▼ ' : ''}{d.date}
              </span>
              {d.isBest && <span className="rounded-full bg-[#e1f5f1] px-1.5 py-0 text-[10px] font-medium text-[#1f6f68]">效率最高</span>}
              {d.isWorst && <span className="rounded-full bg-red-50 px-1.5 py-0 text-[10px] font-medium text-red-600">效率最低</span>}
            </div>
            {/* 三条指标条 */}
            <div className="space-y-1.5 pl-[96px]">
              {METRICS.map((m) => {
                const val = d[m.key]
                if (val == null || !Number.isFinite(val)) return null
                const widthPct = (val / maxEff) * 100
                return (
                  <div key={m.key} className="flex items-center gap-2">
                    <span className="w-[52px] shrink-0 text-right text-[11px] text-slate-400">{m.label}</span>
                    <div className="relative flex-1 overflow-hidden rounded-sm bg-slate-100" style={{ height: 18 }}>
                      <div
                        className="absolute inset-y-0 left-0 rounded-sm transition-all"
                        style={{ width: `${widthPct}%`, backgroundColor: m.color, opacity: 0.85 }}
                      />
                      <span
                        className="absolute inset-y-0 left-0 flex items-center pl-2 text-[11px] font-semibold tabular-nums text-white mix-blend-normal"
                        style={{ lineHeight: '18px' }}
                      >
                        {formatNumber(val, 1)} 票/h
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 区块 B：工时结构分析（每日前台 vs 分拣 vs 其他）──────────────────────────
function HoursStructureSection({ result }: { result: CompareAnalysisResult }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        前台工时不产出扫描量，占比越高对总效率拖累越大。颜色越深代表有效分拣工时越多。
      </p>
      {result.dayMetrics.map((d) => {
        const total = d.totalHours || 1
        const sorterPct = (d.sorterHours / total) * 100
        const frontDeskPct = (d.frontDeskHours / total) * 100
        const otherPct = (d.otherHours / total) * 100
        const isDayBest = d.isBest
        const isDayWorst = d.isWorst

        return (
          <div
            key={d.date}
            className={[
              'rounded-lg border p-3',
              isDayBest ? `border-[${C_ACCENT}]/30 bg-[#e1f5f1]/50` : isDayWorst ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white',
            ].join(' ')}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{d.date}</span>
                {isDayBest && <span className="flex items-center gap-0.5 text-[11px] font-medium" style={{ color: C_ACCENT }}><ArrowUp className="h-3 w-3" />效率最高</span>}
                {isDayWorst && <span className="flex items-center gap-0.5 text-[11px] font-medium text-red-500"><ArrowDown className="h-3 w-3" />效率最低</span>}
              </div>
              <div className="flex items-center gap-3 text-xs tabular-nums text-slate-500">
                <span>总工时 <b className="text-slate-700">{fmtHours(d.totalHours)}</b></span>
                <span>{d.sorterCount} 人</span>
              </div>
            </div>

            {/* 堆叠进度条 */}
            <div className="flex h-5 w-full overflow-hidden rounded-md">
              {sorterPct > 0 && (
                <div
                  className="flex items-center justify-center text-[10px] font-medium text-white"
                  style={{ width: `${sorterPct}%`, backgroundColor: C_ACCENT }}
                  title={`分拣员 ${fmtHours(d.sorterHours)}`}
                >
                  {sorterPct > 10 ? `${formatNumber(sorterPct, 0)}%` : ''}
                </div>
              )}
              {frontDeskPct > 0 && (
                <div
                  className="flex items-center justify-center text-[10px] font-medium text-white"
                  style={{ width: `${frontDeskPct}%`, backgroundColor: C_BLUE }}
                  title={`前台 ${fmtHours(d.frontDeskHours)}`}
                >
                  {frontDeskPct > 8 ? `${formatNumber(frontDeskPct, 0)}%` : ''}
                </div>
              )}
              {otherPct > 0 && (
                <div
                  className="flex items-center justify-center text-[10px] font-medium text-slate-600"
                  style={{ width: `${otherPct}%`, backgroundColor: '#e2e8f0' }}
                  title={`其他 ${fmtHours(d.otherHours)}`}
                >
                  {otherPct > 8 ? `${formatNumber(otherPct, 0)}%` : ''}
                </div>
              )}
            </div>

            {/* 图例 */}
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] tabular-nums text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: C_ACCENT }} />
                分拣员 {fmtHours(d.sorterHours)} ({formatNumber(sorterPct, 0)}%)
              </span>
              {d.frontDeskHours > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: C_BLUE }} />
                  前台 {fmtHours(d.frontDeskHours)} ({formatNumber(frontDeskPct, 0)}%)
                </span>
              )}
              {d.otherHours > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm bg-slate-200" />
                  其他 {fmtHours(d.otherHours)} ({formatNumber(otherPct, 0)}%)
                </span>
              )}
            </div>
          </div>
        )
      })}

      <div className="flex flex-wrap gap-x-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: C_ACCENT }} />分拣员（产出扫描量）</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: C_BLUE }} />前台（不产出扫描量）</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-slate-200" />其他岗位</span>
      </div>
    </div>
  )
}

// ─── 区块 C：逐日人员效率对比表 ──────────────────────────────────────────────
function PersonnelCompareSection({ result }: { result: CompareAnalysisResult }) {
  // 收集出现过的所有人员姓名
  const allPersonnel = useMemo(() => {
    const nameSet = new Set<string>()
    for (const d of result.dayMetrics) {
      for (const p of d.personnel) nameSet.add(p.sorterName)
    }
    return [...nameSet].sort()
  }, [result])

  // 汇总每人每天的工时和角色
  const personnelByDate = useMemo(() => {
    const map = new Map<string, Map<string, { hours: number; isFrontDesk: boolean; isSorterWorker: boolean }>>()
    for (const d of result.dayMetrics) {
      for (const p of d.personnel) {
        if (!map.has(p.sorterName)) map.set(p.sorterName, new Map())
        map.get(p.sorterName)!.set(d.date, {
          hours: p.hours,
          isFrontDesk: p.isFrontDesk,
          isSorterWorker: p.isSorterWorker,
        })
      }
    }
    return map
  }, [result])

  // 找扫描员效率（按姓名 partial match）
  const scannerEffByDate = useMemo(() => {
    const map = new Map<string, Map<string, number | null>>()
    for (const d of result.dayMetrics) {
      for (const s of d.scanners) {
        if (!map.has(s.scanner)) map.set(s.scanner, new Map())
        map.get(s.scanner)!.set(d.date, s.cainiaoAdjustedEfficiency)
      }
    }
    return map
  }, [result])

  const dates = result.dayMetrics.map((d) => d.date)

  if (allPersonnel.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
        暂无人员考勤明细数据
      </div>
    )
  }

  type PersonRow = { name: string; key: string }

  const personColumns: ColumnsType<PersonRow> = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      width: 100,
      fixed: 'left',
      render: (name: string) => <span className="font-medium text-slate-800">{name}</span>,
    },
    ...dates.map((date) => {
      const dm = result.dayMetrics.find((d) => d.date === date)!
      return {
        title: (
          <div className="flex flex-col items-center text-center leading-tight">
            <span className={dm.isBest ? 'font-semibold' : dm.isWorst ? 'font-semibold text-red-600' : ''}>
              {date}
            </span>
            {dm.isBest && <span className="text-[10px]" style={{ color: C_ACCENT }}>▲最高</span>}
            {dm.isWorst && <span className="text-[10px] text-red-500">▼最低</span>}
          </div>
        ),
        key: date,
        width: 116,
        align: 'center' as const,
        render: (_: unknown, row: PersonRow) => {
          const dayData = personnelByDate.get(row.name)?.get(date)
          if (!dayData) {
            return <span className="text-xs text-slate-300">未出勤</span>
          }
          const roleColor = dayData.isFrontDesk ? C_BLUE : C_ACCENT
          const roleLabel = dayData.isFrontDesk ? '前台' : dayData.isSorterWorker ? '分拣' : '其他'

          // 尝试找对应的扫描员效率
          let scanEff: number | null = null
          for (const [scannerKey, dateMap] of scannerEffByDate) {
            if (scannerKey.includes(row.name) || row.name.includes(scannerKey)) {
              scanEff = dateMap.get(date) ?? null
              break
            }
          }

          return (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-xs tabular-nums text-slate-600">{fmtHours(dayData.hours)}</span>
              <Tag
                bordered={false}
                className="mr-0 px-1 py-0 text-[10px] leading-4"
                style={{ backgroundColor: `${roleColor}20`, color: roleColor }}
              >
                {roleLabel}
              </Tag>
              {scanEff != null && (
                <span className="text-[10px] tabular-nums" style={{ color: C_ACCENT }}>
                  {formatNumber(scanEff, 0)}票/h
                </span>
              )}
            </div>
          )
        },
      }
    }),
  ]

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        显示各日期的出勤人员工时与角色（绿=分拣员，蓝=前台）。如有扫描效率数据则显示在角色下方。
      </p>
      <Table<PersonRow>
        rowKey="key"
        columns={personColumns}
        dataSource={allPersonnel.map((name) => ({ name, key: name }))}
        pagination={false}
        scroll={{ x: 120 + dates.length * 116 }}
        size="small"
      />
    </div>
  )
}

// ─── 区块 D：分拣员扫描效率对比 ───────────────────────────────────────────────
function ScannerCompareSection({ result }: { result: CompareAnalysisResult }) {
  const hasScannerData = result.dayMetrics.some((d) => d.scanners.length > 0)

  if (!hasScannerData) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
        暂无分拣员扫描效率数据
      </div>
    )
  }

  const dates = result.dayMetrics.map((d) => d.date)

  // 收集出现过的所有扫描员
  const allScanners = useMemo(() => {
    const set = new Set<string>()
    for (const d of result.dayMetrics) {
      for (const s of d.scanners) set.add(s.scanner)
    }
    return [...set]
  }, [result])

  // 按扫描员 → 日期的效率 map
  const scannerByDate = useMemo(() => {
    const map = new Map<string, Map<string, { scanCount: number; eff: number; cainiaoShare: number }>>()
    for (const d of result.dayMetrics) {
      for (const s of d.scanners) {
        if (!map.has(s.scanner)) map.set(s.scanner, new Map())
        map.get(s.scanner)!.set(d.date, {
          scanCount: s.scanCount,
          eff: s.cainiaoAdjustedEfficiency,
          cainiaoShare: s.cainiaoShare,
        })
      }
    }
    return map
  }, [result])

  // 计算每个扫描员的平均效率用于排序
  const scannersSorted = useMemo(() => {
    return allScanners.sort((a, b) => {
      const avgA =
        Array.from(scannerByDate.get(a)?.values() ?? []).reduce((s, v) => s + v.eff, 0) /
        (scannerByDate.get(a)?.size || 1)
      const avgB =
        Array.from(scannerByDate.get(b)?.values() ?? []).reduce((s, v) => s + v.eff, 0) /
        (scannerByDate.get(b)?.size || 1)
      return avgB - avgA
    })
  }, [allScanners, scannerByDate])

  type ScannerRow = { scanner: string; key: string }

  const scannerColumns: ColumnsType<ScannerRow> = [
    {
      title: '扫描员',
      dataIndex: 'scanner',
      key: 'scanner',
      width: 100,
      fixed: 'left',
      render: (name: string) => <span className="font-medium text-slate-800">{name}</span>,
    },
    ...dates.map((date) => {
      const dm = result.dayMetrics.find((d) => d.date === date)!
      // 该日整体效率用于判断单人高低
      const dayAvgEff = dm.scannerEfficiency ?? (dm.dayEfficiency ?? 0)

      return {
        title: (
          <div className="text-center leading-tight">
            <div className={dm.isBest ? 'font-semibold' : dm.isWorst ? 'font-semibold text-red-600' : ''}>
              {date}
            </div>
            {dm.isBest && <div className="text-[10px]" style={{ color: C_ACCENT }}>▲最高效率日</div>}
            {dm.isWorst && <div className="text-[10px] text-red-500">▼最低效率日</div>}
          </div>
        ),
        key: date,
        width: 120,
        align: 'center' as const,
        render: (_: unknown, row: ScannerRow) => {
          const data = scannerByDate.get(row.scanner)?.get(date)
          if (!data) return <span className="text-xs text-slate-300">—</span>

          const isAboveAvg = data.eff >= dayAvgEff * 1.05
          const isBelowAvg = data.eff < dayAvgEff * 0.9

          return (
            <div className="flex flex-col items-center gap-0.5">
              <span
                className={[
                  'text-sm font-semibold tabular-nums',
                  isAboveAvg ? 'text-green-600' : isBelowAvg ? 'text-red-500' : 'text-slate-700',
                ].join(' ')}
              >
                {formatNumber(data.eff, 0)}
              </span>
              <span className="text-[10px] tabular-nums text-slate-400">{fmtNum(data.scanCount)}票</span>
            </div>
          )
        },
      }
    }),
  ]

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        修正效率（票/h，含菜鸟难度修正）。<span className="text-green-600 font-medium">绿色</span>表示高于当日平均 5%，<span className="text-red-500 font-medium">红色</span>表示低于当日平均 10%。
      </p>
      <Table<ScannerRow>
        rowKey="key"
        columns={scannerColumns}
        dataSource={scannersSorted.map((s) => ({ scanner: s, key: s }))}
        pagination={false}
        scroll={{ x: 120 + dates.length * 120 }}
        size="small"
      />
    </div>
  )
}

// ─── 区块 E：根因诊断进度条 ───────────────────────────────────────────────────
function RootCauseSection({ result }: { result: CompareAnalysisResult }) {
  return (
    <div className="space-y-2.5">
      {result.rootCauses.map((cause, i) => {
        const isTop = i === 0
        const barW = Math.max(2, Math.round(cause.contributionPct))
        const barColor = isTop ? C_ACCENT : cause.isSignificant ? '#64748b' : '#cbd5e1'

        return (
          <div
            key={cause.factor}
            className={[
              'rounded-lg border p-3',
              isTop ? 'border-[#2f8f87]/30 bg-[#e1f5f1]/60' : cause.isSignificant ? 'border-slate-200 bg-slate-50' : 'border-slate-100 bg-white',
            ].join(' ')}
          >
            <div className="flex items-start gap-3">
              <div
                className={[
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                  isTop ? 'text-white' : 'bg-slate-100 text-slate-500',
                ].join(' ')}
                style={isTop ? { backgroundColor: C_ACCENT } : undefined}
              >
                {FACTOR_ICONS[cause.factor]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={['text-sm font-semibold', isTop ? 'text-[#1f6f68]' : cause.isSignificant ? 'text-slate-700' : 'text-slate-400'].join(' ')}>
                      {cause.label}
                    </span>
                    {isTop && <Tag bordered={false} color="green" className="mr-0 py-0 text-[10px] leading-4">主因</Tag>}
                    {!cause.isSignificant && <span className="text-[10px] text-slate-400">无显著影响</span>}
                  </div>
                  <span className={['shrink-0 text-sm font-bold tabular-nums', isTop ? 'text-[#2f8f87]' : cause.isSignificant ? 'text-slate-600' : 'text-slate-300'].join(' ')}>
                    {formatNumber(cause.contributionPct, 1)}%
                  </span>
                </div>
                <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${barW}%`, backgroundColor: barColor }} />
                </div>
                <p className={['text-xs leading-relaxed', cause.isSignificant ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                  {cause.detail}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── 区块 F：AI 深度分析 ───────────────────────────────────────────────────────
function AiAnalysisSection({
  result,
  records,
}: {
  result: CompareAnalysisResult
  records: EfficiencyAttendanceDayRecord[]
}) {
  const [aiProvider, setAiProvider] = useState<EfficiencyInsightAiProvider>('deepseek')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState<EfficiencyAiAnalysis | null>(null)

  const daySnapshots = useMemo(() => buildDaySnapshots(result.dayMetrics), [result])

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await generateCompareInsight(
        daySnapshots,
        result.bestDate,
        result.worstDate,
        result.efficiencyGapPct,
        aiProvider,
      )
      setAnalysis(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 分析失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [daySnapshots, result, aiProvider])

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-[#f7fbff] to-white px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: C_ACCENT }}>
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">AI 深度分析</div>
            <div className="text-[11px] text-slate-500">基于人员构成、扫描效率和工时结构的综合判断</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={aiProvider}
            onChange={setAiProvider}
            options={AI_PROVIDER_OPTIONS}
            style={{ width: 110 }}
          />
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className={[
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              loading
                ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                : 'text-white hover:opacity-90',
            ].join(' ')}
            style={loading ? undefined : { backgroundColor: C_ACCENT }}
          >
            {loading ? (
              <><RefreshCw className="h-3.5 w-3.5 animate-spin" />分析中…</>
            ) : analysis ? (
              <><RefreshCw className="h-3.5 w-3.5" />重新分析</>
            ) : (
              <><Cpu className="h-3.5 w-3.5" />开始分析</>
            )}
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="px-4 py-3">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && !analysis && (
          <div className="flex items-center gap-3 py-4 text-sm text-slate-500">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full animate-bounce"
                  style={{ backgroundColor: C_ACCENT, animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            正在深度分析各日数据差异，请稍候…
          </div>
        )}

        {analysis && !loading && (
          <div className="space-y-4">
            {analysis.findings.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <TrendingDown className="h-3.5 w-3.5" />问题诊断
                </div>
                <ul className="space-y-1.5">
                  {analysis.findings.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.suggestions.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <TrendingUp className="h-3.5 w-3.5" />改善建议
                </div>
                <ul className="space-y-1.5">
                  {analysis.suggestions.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2f8f87]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!analysis && !loading && !error && (
          <div className="py-4 text-center text-sm text-slate-400">
            点击「开始分析」，AI 将结合所有日期的人员明细、扫描员表现和工时结构给出专业诊断。
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 主 Section 标题 ──────────────────────────────────────────────────────────
function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <div className="h-4 w-0.5 rounded-full" style={{ backgroundColor: C_ACCENT }} />
      <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-600">
        {icon}
        {children}
      </h3>
    </div>
  )
}

// ─── 主内容 ───────────────────────────────────────────────────────────────────
function CompareAnalysisContent({ records }: { records: EfficiencyAttendanceDayRecord[] }) {
  const result = useMemo(() => {
    if (records.length < 2) return null
    try {
      return computeCompareAnalysis(records)
    } catch {
      return null
    }
  }, [records])

  if (!result) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-500">
        需至少选择 2 天不同日期进行对比分析
      </div>
    )
  }

  return (
    <div className="space-y-10 pb-10">
      {/* A 效率总览 */}
      <section>
        <SectionLabel icon={<BarChart2 className="h-3.5 w-3.5" />}>效率总览</SectionLabel>
        <EfficiencyChart result={result} />
      </section>

      {/* B 工时结构 */}
      <section>
        <SectionLabel icon={<Clock className="h-3.5 w-3.5" />}>工时结构分析（分拣 vs 前台）</SectionLabel>
        <HoursStructureSection result={result} />
      </section>

      {/* C 人员出勤对比 */}
      <section>
        <SectionLabel icon={<Users className="h-3.5 w-3.5" />}>人员出勤明细对比</SectionLabel>
        <PersonnelCompareSection result={result} />
      </section>

      {/* D 分拣员效率对比 */}
      <section>
        <SectionLabel icon={<TrendingUp className="h-3.5 w-3.5" />}>分拣员扫描效率对比（票/h）</SectionLabel>
        <ScannerCompareSection result={result} />
      </section>

      {/* E 根因诊断 */}
      <section>
        <SectionLabel icon={<Lightbulb className="h-3.5 w-3.5" />}>根因诊断 — 效率差距来源</SectionLabel>
        <RootCauseSection result={result} />
        {result.hasMissingPersonnel && (
          <p className="mt-2 text-xs text-slate-400">部分日期无人员考勤数据，前台工时因素未纳入计算。</p>
        )}
        {result.hasMissingScanner && (
          <p className="mt-1 text-xs text-slate-400">部分日期无扫描员数据，个人效率因素未纳入计算。</p>
        )}
      </section>

      {/* F AI 深度分析 */}
      <section>
        <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />}>AI 深度分析</SectionLabel>
        <AiAnalysisSection result={result} records={records} />
      </section>
    </div>
  )
}

// ─── 入口组件 ─────────────────────────────────────────────────────────────────
export function CompareAnalysisDrawer({ open, onClose, records }: Props) {
  const sortedDates = useMemo(
    () => [...records].sort((a, b) => a.date.localeCompare(b.date)).map((r) => r.date),
    [records],
  )

  const subtitle =
    sortedDates.length === 0
      ? undefined
      : sortedDates.length === 1
        ? sortedDates[0]
        : `${sortedDates[0]} ~ ${sortedDates[sortedDates.length - 1]}（${sortedDates.length} 天）`

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      eyebrow="Compare Analysis"
      title={`效率对比分析（${records.length} 天）`}
      subtitle={subtitle}
      width={Math.min(980, typeof window !== 'undefined' ? window.innerWidth - 48 : 980)}
      destroyOnClose
    >
      <div className="px-6 pt-5">
        <CompareAnalysisContent records={records} />
      </div>
    </AdminDrawer>
  )
}
