import { Alert, Empty, Segmented, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { adminColors } from '../../../theme/adminColors'
import type {
  DispatchPerformanceSupplierOption,
  ProfitDimension,
  ProfitEntitySummary,
  ProfitTrendGranularity,
  ProfitTrendResult,
} from '../dispatchPerformanceTypes'

type Props = {
  result: ProfitTrendResult
  loading: boolean
  dimension: ProfitDimension
  onDimensionChange: (d: ProfitDimension) => void
  granularity: ProfitTrendGranularity
  onGranularityChange: (g: ProfitTrendGranularity) => void
  supplierOptions: DispatchPerformanceSupplierOption[]
  supplierKeys: string[]
  onSupplierKeysChange: (keys: string[]) => void
}

const TREND_TOP_N = 8
const LINE_COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d']

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

/**
 * 路由码维度额外加两列司机侧的钱：一条路由既要看公司在它身上赚多少（主指标 vendorProfit
 * 走前面的「期间利润」列），也要看司机在它身上赚多少。其余两个维度不需要，主指标已经是
 * 对应角度的钱了（供应商维度本身就是公司视角，司机维度本身就是司机视角）。
 */
function routeOnlyColumns(
  t: (key: string, options?: Record<string, unknown>) => string,
  dimension: ProfitDimension,
): ColumnsType<ProfitEntitySummary> {
  if (dimension !== 'route') return []
  return [
    {
      title: t('profitStability.colTotalProfit.courier'),
      key: 'totalCourierProfit',
      width: 140,
      align: 'right',
      sorter: (a, b) => a.totalCourierProfit - b.totalCourierProfit,
      render: (_, row) => (
        <span className="tabular-nums font-medium text-slate-800">{money(row.totalCourierProfit)}</span>
      ),
    },
    {
      title: t('profitStability.colAvgCourierPerDay'),
      key: 'avgCourierProfitPerDay',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.avgCourierProfitPerDay - b.avgCourierProfitPerDay,
      render: (_, row) => <span className="tabular-nums text-slate-700">{money(row.avgCourierProfitPerDay)}</span>,
    },
  ]
}

function ProfitTrendChart({
  entities,
  buckets,
  dimension,
}: {
  entities: ProfitEntitySummary[]
  buckets: string[]
  dimension: ProfitDimension
}) {
  const { t } = useTranslation('dispatchPerformance')
  const containerRef = useRef<HTMLDivElement>(null)
  const top = useMemo(() => entities.slice(0, TREND_TOP_N), [entities])

  const data = useMemo(() => {
    const points: { bucket: string; profit: number; label: string }[] = []
    for (const entity of top) {
      // 与聚合口径一致：司机维度看司机利润，供应商/路由码维度看供应商利润
      const byBucket = new Map(
        entity.byBucket.map((b) => [b.bucket, dimension === 'courier' ? b.courierProfit : b.vendorProfit]),
      )
      for (const bucket of buckets) {
        points.push({ bucket, profit: byBucket.get(bucket) ?? 0, label: entity.label })
      }
    }
    return points
  }, [top, buckets, dimension])

  const dataKey = useMemo(() => data.map((d) => `${d.label}:${d.bucket}:${d.profit}`).join('|'), [data])

  useEffect(() => {
    const el = containerRef.current
    if (!el || top.length === 0 || buckets.length === 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: 320,
      theme: 'light',
      paddingTop: 16,
      paddingRight: 24,
      paddingBottom: 48,
      paddingLeft: 64,
    })

    chart.scale('x', { type: 'band' })
    chart.scale('y', { type: 'linear', nice: true, domainMin: 0 })
    chart.scale('color', { type: 'ordinal', range: LINE_COLORS })
    chart.axis('x', { title: false, labelFontSize: 11 })
    chart.axis('y', {
      title: t('profitStability.chartAxisProfit'),
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
    })
    chart.interaction('tooltip', true)

    chart
      .line()
      .data(data)
      .encode('x', 'bucket')
      .encode('y', 'profit')
      .encode('color', 'label')
      .style('lineWidth', 2)
      .tooltip({
        items: [{ name: t('profitStability.chartAxisProfit'), field: 'profit', valueFormatter: money }],
      })

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [dataKey, top.length, buckets.length, t, data])

  if (top.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('profitStability.empty')} />
  }
  return <div ref={containerRef} role="img" aria-label={t('profitStability.chartTitle')} />
}

/**
 * 利润稳定性面板：供应商 / 路由码 / 司机三个维度共用同一套统计口径（出勤率、波动系数、
 * 期间利润），排序主指标——供应商与路由码看供应商利润，司机看司机利润——见 shared 的注释。
 * 期间总额是结论，趋势图与波动系数只是佐证「稳」是不是真的稳，不是重点。
 */
export function ProfitStabilityPanel({
  result,
  loading,
  dimension,
  onDimensionChange,
  granularity,
  onGranularityChange,
  supplierOptions,
  supplierKeys,
  onSupplierKeysChange,
}: Props) {
  const { t } = useTranslation('dispatchPerformance')

  const entityLabel = (row: ProfitEntitySummary) => {
    if (dimension === 'route' && !row.label) return t('breakdown.noRouteCode')
    return row.label
  }

  const columns: ColumnsType<ProfitEntitySummary> = [
    {
      title: t(`profitStability.dimension.${dimension}`),
      key: 'entity',
      fixed: 'left',
      width: 180,
      render: (_, row) => (
        <div>
          <div className="font-medium text-slate-800">{entityLabel(row)}</div>
          {dimension === 'courier' ? (
            <div className="font-mono text-xs text-slate-400">{row.courierCode}</div>
          ) : null}
        </div>
      ),
    },
    ...(dimension === 'supplier'
      ? []
      : [
          {
            title: t('profitStability.colSuppliers'),
            key: 'suppliers',
            width: 180,
            render: (_: unknown, row: ProfitEntitySummary) => (
              <div className="flex flex-wrap gap-1">
                {row.supplierNames.map((name) => (
                  <Tag key={name} className="m-0 text-xs">
                    {name}
                  </Tag>
                ))}
                {row.supplierNames.length > 1 ? (
                  <Tooltip title={t('profitStability.crossSupplierTooltip')}>
                    <Tag color="processing" className="m-0 cursor-help text-xs">
                      {t('profitStability.crossSupplierTag')}
                    </Tag>
                  </Tooltip>
                ) : null}
              </div>
            ),
          } satisfies ColumnsType<ProfitEntitySummary>[number],
        ]),
    {
      title: t('profitStability.colAttendance'),
      key: 'attendance',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.attendanceRate - b.attendanceRate,
      render: (_, row) => (
        <div className="text-right">
          <div className="tabular-nums font-medium text-slate-700">{row.attendanceRate.toFixed(1)}%</div>
          <div className="text-xs text-slate-400">
            {t('profitStability.attendanceDaysHint', { days: row.attendanceDays, total: result.totalStationDays })}
          </div>
        </div>
      ),
    },
    {
      title: t(`profitStability.colTotalProfit.${dimension === 'courier' ? 'courier' : 'vendor'}`),
      key: 'primaryProfit',
      width: 140,
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.primaryProfit - b.primaryProfit,
      render: (_, row) => (
        <span className="tabular-nums font-medium text-slate-800">{money(row.primaryProfit)}</span>
      ),
    },
    {
      title: t('profitStability.colAvgPerDay'),
      key: 'avgProfitPerDay',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.avgProfitPerDay - b.avgProfitPerDay,
      render: (_, row) => <span className="tabular-nums text-slate-700">{money(row.avgProfitPerDay)}</span>,
    },
    ...routeOnlyColumns(t, dimension),
    {
      title: (
        <Tooltip title={t('profitStability.cvTooltip')}>
          <span className="cursor-help">{t('profitStability.colCv')}</span>
        </Tooltip>
      ),
      key: 'cv',
      width: 100,
      align: 'right',
      sorter: (a, b) => (a.cv ?? Infinity) - (b.cv ?? Infinity),
      render: (_, row) => (
        <span className="tabular-nums text-slate-700">{row.cv == null ? '—' : row.cv.toFixed(2)}</span>
      ),
    },
  ]

  return (
    <section className="admin-panel space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="admin-title text-xl">{t('profitStability.title')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('profitStability.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            mode="multiple"
            allowClear
            placeholder={t('profitStability.allSuppliers')}
            value={supplierKeys}
            onChange={onSupplierKeysChange}
            options={supplierOptions.map((s) => ({ label: s.supplierName, value: s.supplierKey }))}
            className="min-w-[220px]"
            maxTagCount="responsive"
          />
          <Segmented<ProfitDimension>
            value={dimension}
            onChange={onDimensionChange}
            options={[
              { label: t('profitStability.dimension.supplier'), value: 'supplier' },
              { label: t('profitStability.dimension.route'), value: 'route' },
              { label: t('profitStability.dimension.courier'), value: 'courier' },
            ]}
          />
          <Segmented<ProfitTrendGranularity>
            value={granularity}
            onChange={onGranularityChange}
            options={[
              { label: t('profitStability.granularityDay'), value: 'day' },
              { label: t('profitStability.granularityWeek'), value: 'week' },
              { label: t('profitStability.granularityMonth'), value: 'month' },
            ]}
          />
        </div>
      </div>

      {result.entities.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('profitStability.empty')} />
      ) : (
        <>
          <ProfitTrendChart entities={result.entities} buckets={result.buckets} dimension={dimension} />
          {result.entities.length > TREND_TOP_N ? (
            <Alert type="info" showIcon message={t('profitStability.chartTruncated', { shown: TREND_TOP_N })} />
          ) : null}
          <Table<ProfitEntitySummary>
            rowKey="key"
            loading={loading}
            columns={columns}
            dataSource={result.entities}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 'max-content' }}
          />
        </>
      )}
    </section>
  )
}
