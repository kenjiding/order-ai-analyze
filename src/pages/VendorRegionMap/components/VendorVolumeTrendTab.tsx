import { useMemo, useState } from 'react'
import { Alert, Button, DatePicker, Segmented, Select, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import { colorFromMap } from '../vendorColors'
import type { useVendorVolumeTrend } from '../useVendorVolumeTrend'
import {
  TREND_MAX_RANGE_DAYS,
  type VendorTrendSupplier,
} from '../vendorRegionMapTypes'
import { VendorDailyVolumeLineChart } from './VendorDailyVolumeLineChart'
import { VendorVolumeChangeBarChart } from './VendorVolumeChangeBarChart'
import { RouteCodeVolumeHeatmap } from './RouteCodeVolumeHeatmap'

const nf = new Intl.NumberFormat('en-AU')
const nf1 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 })

type Props = {
  trend: ReturnType<typeof useVendorVolumeTrend>
}

const RANGE_PRESET_KEYS = [
  { key: 'last7Days', days: 6 },
  { key: 'last14Days', days: 13 },
  { key: 'last30Days', days: 29 },
] as const

export function VendorVolumeTrendTab({ trend }: Props) {
  const { t } = useTranslation('vendorRegionMap')
  const { t: tc } = useTranslation('common')
  const [chartMode, setChartMode] = useState<'line' | 'stack'>('line')
  const data = trend.data

  const rangePresets = useMemo(
    () =>
      RANGE_PRESET_KEYS.map(({ key, days }) => ({
        label: key === 'last7Days' ? tc('last7Days') : t(`presets.${key}`),
        value: [dayjs().subtract(days, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
      })),
    [t, tc],
  )

  const formatChangeRate = (rate: number | null) => {
    if (rate == null) return t('newBadge')
    return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(1)}%`
  }

  const suppliers = useMemo(() => data?.suppliers ?? [], [data])

  const kpi = useMemo(() => {
    if (!data) return null
    const totalCount = suppliers.reduce((sum, supplier) => sum + supplier.totalCount, 0)
    const routeCodes = new Set(data.routeDaily.filter((row) => row.count > 0).map((row) => row.routeCode))
    const prevAvg = suppliers.reduce((sum, supplier) => sum + supplier.prevAvg, 0)
    const recentAvg = suppliers.reduce((sum, supplier) => sum + supplier.recentAvg, 0)
    return {
      totalCount,
      dailyAvg: data.dates.length > 0 ? totalCount / data.dates.length : 0,
      supplierCount: suppliers.filter((supplier) => supplier.totalCount > 0).length,
      routeCodeCount: routeCodes.size,
      overallChange: prevAvg > 0 ? (recentAvg - prevAvg) / prevAvg : null,
    }
  }, [data, suppliers])

  const columns: ColumnsType<VendorTrendSupplier> = useMemo(
    () => [
    {
      title: t('trend.colVendor'),
      dataIndex: 'supplierName',
      render: (_: unknown, row) => (
        <span className="vrm-trend-cell-name">
          <span
            className="vrm-swatch"
            style={{ background: colorFromMap(trend.vendorColorMap, row.supplierKey) }}
            aria-hidden
          />
          {row.supplierName}
        </span>
      ),
    },
    {
      title: t('trend.colTotal'),
      dataIndex: 'totalCount',
      align: 'right',
      sorter: (a, b) => a.totalCount - b.totalCount,
      render: (value: number) => nf.format(value),
    },
    {
      title: t('trend.colDailyAvg'),
      dataIndex: 'dailyAvg',
      align: 'right',
      sorter: (a, b) => a.dailyAvg - b.dailyAvg,
      render: (value: number) => nf1.format(value),
    },
    {
      title: t('trend.colPeak'),
      dataIndex: 'peakCount',
      align: 'right',
      render: (_: unknown, row) => `${nf.format(row.peakCount)}（${row.peakDate.slice(5)}）`,
    },
    {
      title: t('trend.colTrough'),
      dataIndex: 'lowCount',
      align: 'right',
      render: (_: unknown, row) => `${nf.format(row.lowCount)}（${row.lowDate.slice(5)}）`,
    },
    {
      title: t('trend.colRouteCount'),
      dataIndex: 'routeCodeCount',
      align: 'right',
      sorter: (a, b) => a.routeCodeCount - b.routeCodeCount,
    },
    {
      title: t('trend.colMom'),
      dataIndex: 'changeRate',
      align: 'right',
      sorter: (a, b) => (a.changeRate ?? 0) - (b.changeRate ?? 0),
      render: (value: number | null) => (
        <span
          className={
            value == null ? 'vrm-change' : value < 0 ? 'vrm-change vrm-change--down' : 'vrm-change vrm-change--up'
          }
        >
          {formatChangeRate(value)}
        </span>
      ),
    },
  ],
    [t, trend.vendorColorMap],
  )

  const routeSupplierName =
    suppliers.find((supplier) => supplier.supplierKey === trend.routeSupplierKey)?.supplierName ?? ''

  return (
    <div className="space-y-5">
      <section className="admin-panel vrm-head">
        <div className="vrm-head__main">
          <div className="vrm-head__controls">
            <label className="vrm-field">
              <span className="vrm-field__label">{t('trend.statDate')}</span>
              <DatePicker.RangePicker
                value={trend.dateRange}
                onChange={(values) => {
                  if (values?.[0] && values[1]) trend.setDateRange([values[0], values[1]])
                }}
                format="YYYY-MM-DD"
                inputReadOnly
                allowClear={false}
                presets={rangePresets}
                disabledDate={(current, info) => {
                  if (current.isAfter(dayjs().endOf('day'))) return true
                  // 与后端 MAX_RANGE_DAYS 对齐，别等请求打出去才报错
                  if (info?.from) {
                    return Math.abs(current.diff(info.from, 'day')) >= TREND_MAX_RANGE_DAYS
                  }
                  return false
                }}
              />
            </label>
            <Button type="primary" loading={trend.loading} onClick={() => void trend.query()}>
              {t('query')}
            </Button>
            <span className="vrm-field__hint">{t('trend.queryHint')}</span>
          </div>
        </div>
      </section>

      {trend.error ? <Alert type="error" showIcon message={trend.error} /> : null}

      {data && data.meta.failedDates.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={t('trend.failedDates', { count: data.meta.failedDates.length })}
          description={t('trend.failedDatesList', { dates: data.meta.failedDates.join('、') })}
        />
      ) : null}

      {!data ? (
        <section className="admin-panel">
          <div className="vrm-empty">
            <div className="vrm-empty__title">{t('trend.emptyTitle')}</div>
            <div className="vrm-empty__hint">{t('trend.emptyHint')}</div>
          </div>
        </section>
      ) : (
        <>
          {kpi ? (
            <section className="admin-panel vrm-kpis">
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">{t('trend.totalVolume')}</span>
                <span className="vrm-kpi__value">{nf.format(kpi.totalCount)}</span>
              </div>
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">{t('trend.dailyAvg')}</span>
                <span className="vrm-kpi__value">{nf1.format(kpi.dailyAvg)}</span>
              </div>
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">{t('trend.activeVendors')}</span>
                <span className="vrm-kpi__value">{kpi.supplierCount}</span>
              </div>
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">{t('trend.activeRoutes')}</span>
                <span className="vrm-kpi__value">{kpi.routeCodeCount}</span>
              </div>
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">{t('trend.overallMom')}</span>
                <span
                  className={
                    kpi.overallChange == null
                      ? 'vrm-kpi__value'
                      : kpi.overallChange < 0
                        ? 'vrm-kpi__value vrm-change--down'
                        : 'vrm-kpi__value vrm-change--up'
                  }
                >
                  {formatChangeRate(kpi.overallChange)}
                </span>
              </div>
            </section>
          ) : null}

          <section className="admin-panel vrm-vendors">
            <div className="vrm-vendors__head">
              <div>
                <h2 className="vrm-vendors__title">{t('trend.dailyTrend')}</h2>
                <p className="vrm-vendors__meta">
                  {t('trend.selectedVendors', {
                    selected: trend.selectedSupplierKeys.length,
                    total: suppliers.length,
                  })}
                  {data.meta.lastDayPartial ? t('trend.todayExcluded') : ''}
                </p>
              </div>
              <div className="vrm-vendors__actions">
                <Segmented
                  value={chartMode}
                  onChange={(value) => setChartMode(value as 'line' | 'stack')}
                  options={[
                    { label: t('trendChartMode.line'), value: 'line' },
                    { label: t('trendChartMode.stack'), value: 'stack' },
                  ]}
                />
                <Button onClick={() => trend.selectAllSuppliers()} disabled={suppliers.length === 0}>
                  {t('selectAll')}
                </Button>
                <Button onClick={() => trend.clearSuppliers()} disabled={suppliers.length === 0}>
                  {t('clearSelection')}
                </Button>
              </div>
            </div>

            <div className="vrm-vendors__grid">
              {suppliers.map((supplier) => {
                const checked = trend.selectedSupplierKeys.includes(supplier.supplierKey)
                return (
                  <button
                    key={supplier.supplierKey}
                    type="button"
                    className="vrm-vendor"
                    aria-pressed={checked}
                    onClick={() => trend.toggleSupplier(supplier.supplierKey, !checked)}
                    title={t('trend.vendorChip', {
                      name: supplier.supplierName,
                      count: nf.format(supplier.totalCount),
                      routes: supplier.routeCodeCount,
                    })}
                  >
                    <span
                      className="vrm-swatch"
                      style={{ background: colorFromMap(trend.vendorColorMap, supplier.supplierKey) }}
                      aria-hidden
                    />
                    <span className="vrm-vendor__name">{supplier.supplierName}</span>
                    <span className="vrm-vendor__count">{nf.format(supplier.totalCount)}</span>
                  </button>
                )
              })}
            </div>

            <VendorDailyVolumeLineChart
              dates={data.dates}
              daily={data.daily}
              suppliers={suppliers}
              selectedSupplierKeys={trend.selectedSupplierKeys}
              colorMap={trend.vendorColorMap}
              mode={chartMode}
            />
          </section>

          <section className="admin-panel vrm-vendors">
            <div className="vrm-vendors__head">
              <div>
                <h2 className="vrm-vendors__title">{t('trend.momRanking')}</h2>
                <p className="vrm-vendors__meta">
                  {t('trend.momHint', { days: data.meta.comparableDates.length })}
                </p>
              </div>
            </div>
            <VendorVolumeChangeBarChart
              suppliers={suppliers}
              comparableDays={data.meta.comparableDates.length}
              onSelect={(supplierKey) => trend.setRouteSupplierKey(supplierKey)}
            />
          </section>

          <section className="admin-panel vrm-vendors">
            <div className="vrm-vendors__head">
              <div>
                <h2 className="vrm-vendors__title">{t('trend.routeHeatmap')}</h2>
                <p className="vrm-vendors__meta">{t('trend.routeHeatmapHint')}</p>
              </div>
              <div className="vrm-vendors__actions">
                <Select
                  value={trend.routeSupplierKey || undefined}
                  onChange={(value) => trend.setRouteSupplierKey(value)}
                  placeholder={t('trend.selectVendor')}
                  style={{ minWidth: 220 }}
                  options={suppliers.map((supplier) => ({
                    value: supplier.supplierKey,
                    label: t('trend.vendorOption', {
                      name: supplier.supplierName,
                      count: supplier.routeCodeCount,
                    }),
                  }))}
                />
              </div>
            </div>
            <RouteCodeVolumeHeatmap
              dates={data.dates}
              routeDaily={data.routeDaily}
              supplierKey={trend.routeSupplierKey}
              supplierName={routeSupplierName}
            />
          </section>

          <section className="admin-panel">
            <h2 className="vrm-vendors__title">{t('trend.vendorDetail')}</h2>
            <Table<VendorTrendSupplier>
              className="mt-3"
              rowKey="supplierKey"
              dataSource={suppliers}
              columns={columns}
              pagination={false}
              scroll={{ x: 'max-content' }}
              onRow={(row) => ({
                onClick: () => trend.setRouteSupplierKey(row.supplierKey),
              })}
            />
          </section>
        </>
      )}
    </div>
  )
}
