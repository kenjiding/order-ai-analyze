import { Alert, Collapse, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Store } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import KpiHeroGrid from './components/KpiHeroGrid'
import NewMerchantFilterPanel from './components/NewMerchantFilterPanel'
import NewMerchantPushBar from './components/NewMerchantPushBar'
import RouteCodePerformanceSection from './components/RouteCodePerformanceSection'
import TransitTimeDistributionChart from './components/TransitTimeDistributionChart'
import type { WaybillRecord } from './metrics'
import { useNewMerchantFeishuPush } from './useNewMerchantFeishuPush'
import { useNewMerchantMonitorPage } from './useNewMerchantMonitorPage'

type RawRow = {
  key: string
  waybillNo: string
  clientCode: string
  actualReceiveStation: string
  firstCountryDate: string
  firstDsArriveDate: string
  signDate: string
}

const RAW_COLUMNS: ColumnsType<RawRow> = [
  { title: '运单号', dataIndex: 'waybillNo', key: 'waybillNo', width: 180, ellipsis: true },
  { title: '商家代码', dataIndex: 'clientCode', key: 'clientCode', width: 130 },
  { title: '收件站点', dataIndex: 'actualReceiveStation', key: 'actualReceiveStation', width: 160 },
  { title: '首次到国时间', dataIndex: 'firstCountryDate', key: 'firstCountryDate', width: 170 },
  { title: '首次到件时间', dataIndex: 'firstDsArriveDate', key: 'firstDsArriveDate', width: 170 },
  { title: '签收时间', dataIndex: 'signDate', key: 'signDate', width: 170 },
]

function toRawRow(rec: WaybillRecord, index: number): RawRow {
  const v = (k: string) => String(rec[k] ?? '').trim()
  return {
    key: `${v('waybillNo') || 'row'}-${index}`,
    waybillNo: v('waybillNo') || v('mainWaybillNo') || '-',
    clientCode: v('clientCode') || '-',
    actualReceiveStation: v('actualReceiveStation') || '-',
    firstCountryDate: v('firstCountryDate') || '-',
    firstDsArriveDate: v('firstDsArriveDate') || '-',
    signDate: v('signDate') || '-',
  }
}

function formatWindowLabel(meta: { startTime: string; endTime: string } | null): string {
  if (!meta) return ''
  return `${meta.startTime.slice(0, 10)} ~ ${meta.endTime.slice(0, 10)}`
}

function formatGeneratedAt(): string {
  const n = new Date()
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}`
}

export default function NewMerchantMonitorPage() {
  const state = useNewMerchantMonitorPage()
  const hasData = state.records.length > 0

  const rawRows = useMemo<RawRow[]>(
    () => state.records.slice(0, 200).map((rec, i) => toRawRow(rec, i)),
    [state.records],
  )

  const windowLabel = formatWindowLabel(state.lastQueryMeta)

  const buildPayload = useCallback(() => {
    if (!hasData || !state.lastQueryMeta) return null
    return {
      clientCodes: state.lastQueryMeta.clientCodes,
      windowLabel,
      generatedAt: formatGeneratedAt(),
      metrics: state.metrics,
      transitDistribution: state.transitDistribution,
      routeCodeRows: state.routeCodeRows,
    }
  }, [
    hasData,
    state.lastQueryMeta,
    state.metrics,
    state.transitDistribution,
    state.routeCodeRows,
    windowLabel,
  ])

  const push = useNewMerchantFeishuPush({ buildPayload })

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-[#1f6f68]" aria-hidden />
            <h1 className="text-xl font-semibold text-slate-900">新商家数据监控</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            按新商家代码与首次到国时间窗口拉取运单，监控总货量、签收效率与转运耗时。
          </p>
        </div>
        {state.lastQueryMeta ? (
          <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {state.lastQueryMeta.clientCodes.map((code) => (
              <Tag key={code} color="cyan">
                {code}
              </Tag>
            ))}
            <span className="ml-2">
              {state.lastQueryMeta.startTime.slice(0, 10)} ~{' '}
              {state.lastQueryMeta.endTime.slice(0, 10)}
            </span>
          </div>
        ) : null}
      </header>

      <NewMerchantFilterPanel
        clientCodesText={state.clientCodesText}
        onChangeClientCodes={state.setClientCodesText}
        dateRange={state.dateRange}
        onChangeDateRange={state.setDateRange}
        loading={state.loading}
        canSubmit={state.canSubmit}
        onSubmit={() => {
          void state.handleQuery()
        }}
      />

      {state.error ? (
        <Alert type="error" showIcon message="查询失败" description={state.error} />
      ) : null}

      <KpiHeroGrid metrics={state.metrics} hasData={hasData} />

      {hasData ? <TransitTimeDistributionChart buckets={state.transitDistribution} /> : null}

      {hasData ? (
        <RouteCodePerformanceSection
          records={state.records}
          routeCodeRows={state.routeCodeRows}
          thresholds={state.thresholds}
          onThresholdsChange={state.setThresholds}
        />
      ) : null}

      {hasData ? (
        <NewMerchantPushBar
          config={push.config}
          onChange={push.updateConfig}
          pushing={push.pushing}
          disabled={!hasData}
          onPush={() => {
            void push.handlePush()
          }}
        />
      ) : null}

      {hasData ? (
        <Collapse
          items={[
            {
              key: 'raw',
              label: `原始记录预览（前 ${rawRows.length} 条 / 共 ${state.records.length} 条）`,
              children: (
                <Table<RawRow>
                  columns={RAW_COLUMNS}
                  dataSource={rawRows}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 980 }}
                />
              ),
            },
          ]}
        />
      ) : null}
    </div>
  )
}
