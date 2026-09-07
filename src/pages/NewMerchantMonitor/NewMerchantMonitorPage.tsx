import { Alert, Collapse, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Store } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('newMerchant')
  const state = useNewMerchantMonitorPage()
  const hasData = state.records.length > 0

  const rawColumns: ColumnsType<RawRow> = useMemo(
    () => [
      { title: t('colWaybillNo'), dataIndex: 'waybillNo', key: 'waybillNo', width: 180, ellipsis: true },
      { title: t('colClientCode'), dataIndex: 'clientCode', key: 'clientCode', width: 130 },
      { title: t('colReceiveStation'), dataIndex: 'actualReceiveStation', key: 'actualReceiveStation', width: 160 },
      { title: t('colFirstCountry'), dataIndex: 'firstCountryDate', key: 'firstCountryDate', width: 170 },
      { title: t('colFirstDsArrive'), dataIndex: 'firstDsArriveDate', key: 'firstDsArriveDate', width: 170 },
      { title: t('colSignDate'), dataIndex: 'signDate', key: 'signDate', width: 170 },
    ],
    [t],
  )

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
            <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">{t('description')}</p>
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
        <Alert type="error" showIcon message={t('queryFailed')} description={state.error} />
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
              label: t('rawPreview', { shown: rawRows.length, total: state.records.length }),
              children: (
                <Table<RawRow>
                  columns={rawColumns}
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
