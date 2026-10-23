import { Alert, Button, DatePicker, Empty, Table, Tabs } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Package,
  Scale,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DIMENSION_CHART_TOP_N, DimensionRangeChart } from './components/DimensionRangeChart'
import { MiniBarCell } from './components/MiniBarCell'
import { WeightRangeEditor } from './components/WeightRangeEditor'
import { useWeightStatPage } from './useWeightStatPage'
import type { DimensionRangeRow, WeightDimension } from './weightStatApi'

/**
 * tone 决定图标底色，不只是装饰——"warning" 用于缺失重量这类需要一眼扫出异常的指标：
 * 图标 + 色底 + 色字三重提示，不单靠颜色。默认 tone 之间也用 accent/sky 两种已有品牌色区分，
 * 不是五张卡全部套同一个灰框样式。
 */
const KPI_TONES = {
  accent: { chipBg: 'var(--admin-accent-soft)', chipFg: 'var(--admin-accent)' },
  sky: { chipBg: 'var(--admin-sky-soft)', chipFg: '#25526e' },
  warning: { chipBg: '#fef3c7', chipFg: '#b45309' },
  neutral: { chipBg: 'var(--admin-surface-soft)', chipFg: '#65758b' },
} as const

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  icon: LucideIcon
  tone?: keyof typeof KPI_TONES
}) {
  const palette = KPI_TONES[tone]
  const isWarning = tone === 'warning'
  return (
    <div
      className="rounded-xl bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
      style={{ border: `1px solid ${isWarning ? '#fde68a' : 'var(--admin-line)'}` }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: palette.chipBg, color: palette.chipFg }}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
      </div>
      <div
        className="mt-2.5 text-2xl font-semibold tabular-nums"
        style={{ color: isWarning ? palette.chipFg : 'var(--admin-text)' }}
      >
        {value}
      </div>
      {hint ? (
        <div className={`mt-0.5 text-xs ${isWarning ? 'text-amber-600' : 'text-slate-400'}`}>{hint}</div>
      ) : null}
    </div>
  )
}

export default function WeightStatPage() {
  const { t } = useTranslation('weightStat')
  const v = useWeightStatPage()

  const dimensionColumns = useMemo<ColumnsType<DimensionRangeRow>>(() => {
    const cols: ColumnsType<DimensionRangeRow> = [
      {
        title: t('dimension.name'),
        dataIndex: 'label',
        fixed: 'left',
        width: 180,
        ellipsis: true,
        render: (label: string) => label || t('dimension.unassigned'),
      },
      {
        title: t('dimension.total'),
        dataIndex: 'total',
        width: 90,
        align: 'right',
        sorter: (a, b) => a.total - b.total,
        defaultSortOrder: 'descend',
      },
    ]
    v.rangeStats.forEach((r, idx) => {
      // 迷你条按列内最大占比归一化：自定义区间往往占总件数不到 1%，直接按真实占比画条会细到看不见
      const columnMaxPct = Math.max(
        ...v.dimensionRangeStats.map((row) => row.cells[idx]?.pct ?? 0),
        0.0001,
      )
      cols.push({
        title: `[${r.min}, ${r.max}]`,
        key: `range-${r.id}`,
        width: 150,
        align: 'right',
        render: (_, row) => {
          const cell = row.cells[idx]
          if (!cell) return '—'
          return <MiniBarCell count={cell.count} pct={cell.pct} barWidthPct={(cell.pct / columnMaxPct) * 100} />
        },
      })
    })
    return cols
  }, [t, v.rangeStats, v.dimensionRangeStats])

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">{t('page.eyebrow')}</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <Scale className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              {t('page.title')}
            </h2>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {t('filter.inboundRange')}
              </label>
              <DatePicker.RangePicker
                value={v.dateRange}
                onChange={(values) => v.setDateRange((values as [Dayjs, Dayjs] | null) ?? null)}
                format="YYYY-MM-DD"
                allowClear
                className="w-[280px]"
              />
            </div>
            <Button
              type="primary"
              loading={v.loading}
              disabled={!v.canSubmit}
              icon={<Search className="h-4 w-4" aria-hidden />}
              onClick={() => void v.handleQuery()}
            >
              {t('filter.query')}
            </Button>
          </div>
          <div className="mt-1.5 text-xs text-slate-400">
            {v.loading ? t('filter.querying') : t('filter.rangeHint')}
          </div>
        </div>
      </div>

      {v.error ? <Alert type="error" showIcon message={v.error} /> : null}

      {!v.result || !v.summary ? (
        <div className="admin-panel py-16">
          <Empty description={t('empty')} />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard label={t('kpi.total')} value={String(v.summary.total)} icon={Package} tone="accent" />
            <KpiCard
              label={t('kpi.withWeight')}
              value={String(v.summary.withWeight)}
              icon={CheckCircle2}
              tone="sky"
            />
            <KpiCard
              label={t('kpi.missing')}
              value={String(v.summary.missingCount)}
              hint={v.summary.missingCount > 0 ? t('kpi.missingHint', { count: v.summary.missingCount }) : undefined}
              icon={AlertTriangle}
              tone={v.summary.missingCount > 0 ? 'warning' : 'neutral'}
            />
            <KpiCard label={t('kpi.mean')} value={v.summary.mean.toFixed(3)} icon={Scale} tone="sky" />
            <KpiCard label={t('kpi.stdDev')} value={v.summary.stdDev.toFixed(3)} icon={Activity} tone="accent" />
          </div>

          <WeightRangeEditor stats={v.rangeStats} onAdd={v.addRange} onRemove={v.removeRange} />

          <section className="admin-panel overflow-hidden">
            <Tabs
              activeKey={v.dimension}
              onChange={(key) => v.setDimension(key as WeightDimension)}
              items={[
                { key: 'supplier', label: t('dimension.bySupplier') },
                { key: 'route', label: t('dimension.byRoute') },
              ]}
              className="px-4 pt-2"
            />
            {v.ranges.length === 0 ? (
              <div className="px-4 pb-5">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dimension.needRanges')} />
              </div>
            ) : (
              <>
                <div className="px-4 pb-2">
                  <p className="mb-3 text-xs text-slate-400">
                    {t('dimension.subtitle')}
                    {v.dimensionRangeStats.length > DIMENSION_CHART_TOP_N
                      ? ` ${t('dimension.truncated', {
                          total: v.dimensionRangeStats.length,
                          shown: DIMENSION_CHART_TOP_N,
                        })}`
                      : ''}
                  </p>
                  <DimensionRangeChart rows={v.dimensionRangeStats} />
                </div>
                <Table<DimensionRangeRow>
                  rowKey="key"
                  columns={dimensionColumns}
                  dataSource={v.dimensionRangeStats}
                  scroll={{ x: 180 + 90 + v.rangeStats.length * 150 }}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
