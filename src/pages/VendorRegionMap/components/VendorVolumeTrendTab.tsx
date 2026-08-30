import { useMemo, useState } from 'react'
import { Alert, Button, DatePicker, Segmented, Select, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
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

const RANGE_PRESETS = [
  {
    label: '近 7 天',
    value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
  },
  {
    label: '近 14 天',
    value: [dayjs().subtract(13, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
  },
  {
    label: '近 30 天',
    value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
  },
]

function formatChangeRate(rate: number | null): string {
  if (rate == null) return '新增'
  return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(1)}%`
}

export function VendorVolumeTrendTab({ trend }: Props) {
  const [chartMode, setChartMode] = useState<'line' | 'stack'>('line')
  const data = trend.data

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

  const columns: ColumnsType<VendorTrendSupplier> = [
    {
      title: '供应商',
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
      title: '总票量',
      dataIndex: 'totalCount',
      align: 'right',
      sorter: (a, b) => a.totalCount - b.totalCount,
      render: (value: number) => nf.format(value),
    },
    {
      title: '日均',
      dataIndex: 'dailyAvg',
      align: 'right',
      sorter: (a, b) => a.dailyAvg - b.dailyAvg,
      render: (value: number) => nf1.format(value),
    },
    {
      title: '峰值',
      dataIndex: 'peakCount',
      align: 'right',
      render: (_: unknown, row) => `${nf.format(row.peakCount)}（${row.peakDate.slice(5)}）`,
    },
    {
      title: '谷值',
      dataIndex: 'lowCount',
      align: 'right',
      render: (_: unknown, row) => `${nf.format(row.lowCount)}（${row.lowDate.slice(5)}）`,
    },
    {
      title: '路由码数',
      dataIndex: 'routeCodeCount',
      align: 'right',
      sorter: (a, b) => a.routeCodeCount - b.routeCodeCount,
    },
    {
      title: '环比',
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
  ]

  const routeSupplierName =
    suppliers.find((supplier) => supplier.supplierKey === trend.routeSupplierKey)?.supplierName ?? ''

  return (
    <div className="space-y-5">
      <section className="admin-panel vrm-head">
        <div className="vrm-head__main">
          <div className="vrm-head__controls">
            <label className="vrm-field">
              <span className="vrm-field__label">统计日期</span>
              <DatePicker.RangePicker
                value={trend.dateRange}
                onChange={(values) => {
                  if (values?.[0] && values[1]) trend.setDateRange([values[0], values[1]])
                }}
                format="YYYY-MM-DD"
                inputReadOnly
                allowClear={false}
                presets={RANGE_PRESETS}
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
              查询
            </Button>
            <span className="vrm-field__hint">
              按天逐日拉取到件数据，区间越长越慢（14 天约 5~15 秒）
            </span>
          </div>
        </div>
      </section>

      {trend.error ? <Alert type="error" showIcon message={trend.error} /> : null}

      {data && data.meta.failedDates.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`有 ${data.meta.failedDates.length} 天到件数据拉取失败，已从所有统计中剔除（不按 0 票处理）`}
          description={`失败日期：${data.meta.failedDates.join('、')}`}
        />
      ) : null}

      {!data ? (
        <section className="admin-panel">
          <div className="vrm-empty">
            <div className="vrm-empty__title">还没有趋势数据</div>
            <div className="vrm-empty__hint">选好统计日期区间后点「查询」。</div>
          </div>
        </section>
      ) : (
        <>
          {kpi ? (
            <section className="admin-panel vrm-kpis">
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">区间总票量</span>
                <span className="vrm-kpi__value">{nf.format(kpi.totalCount)}</span>
              </div>
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">日均票量</span>
                <span className="vrm-kpi__value">{nf1.format(kpi.dailyAvg)}</span>
              </div>
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">活跃供应商</span>
                <span className="vrm-kpi__value">{kpi.supplierCount}</span>
              </div>
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">活跃路由码</span>
                <span className="vrm-kpi__value">{kpi.routeCodeCount}</span>
              </div>
              <div className="vrm-kpi">
                <span className="vrm-kpi__label">整体环比</span>
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
                <h2 className="vrm-vendors__title">按日货量趋势</h2>
                <p className="vrm-vendors__meta">
                  已选 {trend.selectedSupplierKeys.length} / {suppliers.length} 家
                  {data.meta.lastDayPartial
                    ? ' · 当天数据尚未跑完，已排除出环比计算'
                    : ''}
                </p>
              </div>
              <div className="vrm-vendors__actions">
                <Segmented
                  value={chartMode}
                  onChange={(value) => setChartMode(value as 'line' | 'stack')}
                  options={[
                    { label: '折线', value: 'line' },
                    { label: '堆叠面积', value: 'stack' },
                  ]}
                />
                <Button onClick={() => trend.selectAllSuppliers()} disabled={suppliers.length === 0}>
                  全选
                </Button>
                <Button onClick={() => trend.clearSuppliers()} disabled={suppliers.length === 0}>
                  清空
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
                    title={`${supplier.supplierName}：${nf.format(supplier.totalCount)} 票 / ${supplier.routeCodeCount} 条路由码`}
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
                <h2 className="vrm-vendors__title">环比涨跌排行</h2>
                <p className="vrm-vendors__meta">
                  区间对半切，后半段日均 vs 前半段日均（可比 {data.meta.comparableDates.length} 天）。
                  掉量的排在最上 —— 这几家最可能先裁司机。点条形可切换下方的路由码视图。
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
                <h2 className="vrm-vendors__title">路由码货量分布</h2>
                <p className="vrm-vendors__meta">
                  一个路由码≈一条司机线路。某行由深转浅直至断掉 = 这条线路没货了；新出现的行 = 扩容。
                </p>
              </div>
              <div className="vrm-vendors__actions">
                <Select
                  value={trend.routeSupplierKey || undefined}
                  onChange={(value) => trend.setRouteSupplierKey(value)}
                  placeholder="选择供应商"
                  style={{ minWidth: 220 }}
                  options={suppliers.map((supplier) => ({
                    value: supplier.supplierKey,
                    label: `${supplier.supplierName}（${supplier.routeCodeCount} 条路由）`,
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
            <h2 className="vrm-vendors__title">供应商明细</h2>
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
