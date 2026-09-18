import { Alert, Button, DatePicker, Empty, Radio, Table, Tabs } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { Search, Timer } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HourlyExitChart } from './components/HourlyExitChart'
import {
  formatPct,
  MATRIX_NEXT_DAY_HOURS,
  nextDayHourSlotIndex,
  ratePct,
  type ExitRateDimRow,
} from './exitRateQueryApi'
import { useExitRateQueryPage, type ExitRateDimTab } from './useExitRateQueryPage'

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-slate-400">{hint}</div> : null}
    </div>
  )
}

function RateText({ met, total }: { met: number; total: number }) {
  const pct = ratePct(met, total)
  return (
    <span className="tabular-nums">
      {formatPct(pct)}
      <span className="ml-1 text-slate-400">{met}</span>
    </span>
  )
}

export default function ExitRateQueryPage() {
  const { t } = useTranslation('exitRateQuery')
  const v = useExitRateQueryPage()
  const result = v.result
  const view = v.view

  const columns = useMemo<ColumnsType<ExitRateDimRow>>(
    () => [
      {
        title: t('dim.name'),
        dataIndex: 'name',
        ellipsis: true,
        render: (name: string) => name || t('dim.unassigned'),
        fixed: 'left',
        width: 180,
      },
      {
        title: t('dim.total'),
        dataIndex: 'total',
        width: 88,
        align: 'right',
        sorter: (a, b) => a.total - b.total,
        defaultSortOrder: 'descend',
      },
      {
        title: t('dim.share'),
        key: 'share',
        width: 96,
        align: 'right',
        render: (_, row) => formatPct(ratePct(row.total, view?.total ?? 0)),
      },
      {
        title: t('dim.sameDay'),
        key: 'sameDay',
        width: 120,
        align: 'right',
        sorter: (a, b) => (ratePct(a.sameDay, a.total) ?? -1) - (ratePct(b.sameDay, b.total) ?? -1),
        render: (_, row) => <RateText met={row.sameDay} total={row.total} />,
      },
      {
        title: t('dim.nextMorning'),
        key: 'nextMorning',
        width: 140,
        align: 'right',
        sorter: (a, b) =>
          (ratePct(a.nextMorning, a.total) ?? -1) - (ratePct(b.nextMorning, b.total) ?? -1),
        render: (_, row) => <RateText met={row.nextMorning} total={row.total} />,
      },
      {
        title: t('dim.cumulative'),
        key: 'cumulative',
        width: 140,
        align: 'right',
        sorter: (a, b) =>
          (ratePct(a.sameDay + a.nextMorning, a.total) ?? -1) -
          (ratePct(b.sameDay + b.nextMorning, b.total) ?? -1),
        render: (_, row) => <RateText met={row.sameDay + row.nextMorning} total={row.total} />,
      },
      {
        title: t('dim.pending'),
        dataIndex: 'pending',
        width: 88,
        align: 'right',
      },
    ],
    [view?.total, t],
  )

  const hourColumns = useMemo<ColumnsType<ExitRateDimRow>>(() => {
    const cols: ColumnsType<ExitRateDimRow> = [
      {
        title: t('dim.name'),
        dataIndex: 'name',
        ellipsis: true,
        render: (name: string) => name || t('dim.unassigned'),
        fixed: 'left',
        width: 160,
      },
    ]
    for (const hour of MATRIX_NEXT_DAY_HOURS) {
      const slot = nextDayHourSlotIndex(hour)
      const start = String(hour).padStart(2, '0')
      const end = String(hour + 1).padStart(2, '0')
      cols.push({
        title: `${start}–${end}`,
        key: `h${slot}`,
        width: 88,
        align: 'right',
        render: (_, row) => {
          const count = row.byHour?.[slot] ?? 0
          return (
            <span className="tabular-nums">
              {formatPct(ratePct(count, row.total))}
              <div className="text-[11px] text-slate-400">{count}</div>
            </span>
          )
        },
      })
    }
    cols.push({
      title: t('hourly.matrixRangeTotal'),
      key: 'h7to11',
      width: 110,
      align: 'right',
      render: (_, row) => {
        const met = MATRIX_NEXT_DAY_HOURS.reduce(
          (sum, hour) => sum + (row.byHour?.[nextDayHourSlotIndex(hour)] ?? 0),
          0,
        )
        return <RateText met={met} total={row.total} />
      },
    })
    return cols
  }, [t])

  const chartHours = v.selectedRow?.byHour ?? view?.byHour ?? []
  const chartTotal = v.selectedRow?.total ?? view?.total ?? 0
  const chartTitle = v.selectedRow
    ? v.selectedRow.name || t('dim.unassigned')
    : t('hourly.overall')

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">{t('page.eyebrow')}</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <Timer className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              {t('page.title')}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{t('page.description')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
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
            <div className="mt-1 text-xs text-slate-400">{t('filter.rangeHint')}</div>
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
        {v.loading ? (
          <p className="px-5 pb-4 text-xs text-slate-400">{t('filter.querying')}</p>
        ) : null}
      </div>

      {v.error ? <Alert type="error" showIcon message={v.error} /> : null}

      {!result || !view ? (
        <div className="admin-panel py-16">
          <Empty description={t('empty')} />
        </div>
      ) : (
        <>
          {result.dates.length > 1 ? (
            <div className="admin-panel px-5 py-3">
              <div className="mb-2 text-xs font-medium text-slate-500">{t('filter.viewDate')}</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type={v.viewDate == null ? 'primary' : 'default'}
                  onClick={() => v.onChangeViewDate(null)}
                >
                  {t('filter.allDates')}
                </Button>
                {result.dates.map((date) => (
                  <Button
                    key={date}
                    type={v.viewDate === date ? 'primary' : 'default'}
                    onClick={() => v.onChangeViewDate(date)}
                  >
                    {date.slice(5).replace('-', '/')}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={t('kpi.total')}
              value={String(view.total)}
              hint={t('kpi.pending', { count: view.pending })}
            />
            <KpiCard
              label={t('kpi.sameDay')}
              value={formatPct(ratePct(view.sameDay, view.total))}
              hint={t('kpi.sameDayHint', { count: view.sameDay })}
            />
            <KpiCard
              label={t('kpi.nextMorning')}
              value={formatPct(ratePct(view.nextMorning, view.total))}
              hint={t('kpi.nextMorningHint', { count: view.nextMorning })}
            />
            <KpiCard
              label={t('kpi.cumulative')}
              value={formatPct(ratePct(view.sameDay + view.nextMorning, view.total))}
              hint={t('kpi.cumulativeHint', { count: view.sameDay + view.nextMorning })}
            />
          </div>

          <section className="admin-panel overflow-hidden">
            <Tabs
              activeKey={v.dimTab}
              onChange={(key) => v.onChangeTab(key as ExitRateDimTab)}
              items={[
                { key: 'vendor', label: t('dim.vendor') },
                { key: 'route', label: t('dim.route') },
                { key: 'driver', label: t('dim.driver') },
              ]}
              className="px-4 pt-2"
            />
            <Table<ExitRateDimRow>
              rowKey={(row) => row.key || '__empty__'}
              columns={columns}
              dataSource={v.dimRows}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              scroll={{ x: 900 }}
              rowClassName={(row) =>
                row.key === v.selectedKey ? 'bg-[var(--admin-accent-soft)]' : ''
              }
              onRow={(row) => ({
                onClick: () => v.setSelectedKey(row.key === v.selectedKey ? null : row.key),
                className: 'cursor-pointer',
              })}
            />
          </section>

          <section className="admin-panel p-5">
            <div className="mb-3">
              <h3 className="text-base font-semibold text-slate-900">{t('hourly.title')}</h3>
              <p className="mt-1 text-sm text-slate-500">{t('hourly.subtitle')}</p>
              <p className="mt-1 text-xs text-slate-400">{chartTitle}</p>
            </div>
            <HourlyExitChart byHour={chartHours} total={chartTotal} title={chartTitle} />
            <div className="mb-1 mt-5 flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-medium text-slate-700">{t('hourly.matrixTitle')}</h4>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                value={v.hideZeroMatrixRows ? 'hideZero' : 'all'}
                onChange={(e) => v.setHideZeroMatrixRows(e.target.value === 'hideZero')}
              >
                <Radio.Button value="all">{t('hourly.matrixShowAll')}</Radio.Button>
                <Radio.Button value="hideZero">{t('hourly.matrixHideZero')}</Radio.Button>
              </Radio.Group>
            </div>
            <p className="mb-2 text-xs text-slate-400">{t('hourly.matrixHideZeroHint')}</p>
            <Tabs
              activeKey={v.matrixTab}
              onChange={(key) => v.onChangeMatrixTab(key as ExitRateDimTab)}
              items={[
                { key: 'vendor', label: t('dim.vendor') },
                { key: 'route', label: t('dim.route') },
                { key: 'driver', label: t('dim.driver') },
              ]}
            />
            <Table<ExitRateDimRow>
              rowKey={(row) => `h-${row.key || '__empty__'}`}
              columns={hourColumns}
              dataSource={v.matrixRows}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              scroll={{ x: 720 }}
              rowClassName={(row) =>
                row.key === v.matrixSelectedKey ? 'bg-[var(--admin-accent-soft)]' : ''
              }
              onRow={(row) => ({
                onClick: () =>
                  v.setMatrixSelectedKey(row.key === v.matrixSelectedKey ? null : row.key),
                className: 'cursor-pointer',
              })}
            />
          </section>
        </>
      )}
    </div>
  )
}
