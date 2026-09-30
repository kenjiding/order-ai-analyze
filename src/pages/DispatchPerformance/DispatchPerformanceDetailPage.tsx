import { useState } from 'react'
import { Alert, Button, DatePicker, Popconfirm, Segmented, Select, Tag, Tooltip } from 'antd'
import { AlertTriangle, ArrowLeft, Download, RefreshCw, Send, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import type { Dayjs } from 'dayjs'
import { PERMISSION_KEYS, usePermission } from '../../hooks/usePermission'
import {
  DEFAULT_DISPATCH_RANKING_WEIGHTS,
  type DispatchRankingMetricKey,
} from '../../../shared/dispatchPerformance/rankingScore'
import { AttributionWaterfall } from './components/AttributionWaterfall'
import { DispatchDataPushModal } from './components/DispatchDataPushModal'
import { DispatchExceptionPanel } from './components/DispatchExceptionPanel'
import { ProfitStabilityPanel } from './components/ProfitStabilityPanel'
import { PerformanceBreakdownTable } from './components/PerformanceBreakdownTable'
import { UnmetParetoChart } from './components/UnmetParetoChart'
import { SettleNowResult } from './components/SettleNowResult'
import { SupplierRankingBoard } from './components/SupplierRankingBoard'
import { useDispatchPerformanceDetailPage } from './useDispatchPerformanceDetailPage'
import { useProfitStabilityTrend } from './useProfitStabilityTrend'
import { exportDispatchPerformanceToXlsx } from './exportDispatchPerformance'
import type { DispatchMetrics, DispatchSettledBatch, WhitelistMode } from './dispatchPerformanceTypes'

const { RangePicker } = DatePicker

function SummaryTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warn'
}) {
  return (
    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === 'warn' ? 'text-amber-600' : 'text-slate-950'
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-slate-400">{hint}</div> : null}
    </div>
  )
}

function formatRate(rate: number | null): string {
  return rate == null ? '—' : `${rate.toFixed(2)}%`
}

function SummaryTiles({
  overall,
  t,
}: {
  overall: DispatchMetrics
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const { quadrant } = overall
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryTile
        label={t('detail.before11HubExitRate')}
        value={formatRate(overall.before11Rate)}
        hint={t('detail.ordersHint', { met: overall.before11Met, total: overall.total })}
      />
      <SummaryTile
        label={t('detail.signRate24h')}
        value={overall.dispatchSettled ? formatRate(overall.signRate) : t('detail.settling')}
        hint={
          overall.dispatchSettled
            ? t('detail.ordersHint', { met: overall.signMet, total: overall.total })
            : t('detail.signPendingHint')
        }
      />
      <SummaryTile
        label={t('detail.exitMetSignUnmet')}
        value={overall.dispatchSettled ? String(quadrant.exitMetSignUnmet) : '—'}
        hint={t('detail.exitMetSignUnmetHint')}
        tone={overall.dispatchSettled && quadrant.exitMetSignUnmet > 0 ? 'warn' : 'default'}
      />
      <SummaryTile
        label={t('detail.exitUnmetSignUnmet')}
        value={overall.dispatchSettled ? String(quadrant.exitUnmetSignUnmet) : '—'}
        hint={t('detail.exitUnmetSignUnmetHint')}
        tone={overall.dispatchSettled && quadrant.exitUnmetSignUnmet > 0 ? 'warn' : 'default'}
      />
    </div>
  )
}

function SettleProgress({
  batches,
  t,
}: {
  batches: DispatchSettledBatch[]
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  if (batches.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">{t('detail.recentSettle')}</span>
      {batches.map((batch) => (
        <Tooltip
          key={batch.arrivalDate}
          title={
            <div className="text-xs">
              <div>{t('detail.arrivalDate', { date: batch.arrivalDate })}</div>
              <div>{t('detail.waybillCount', { count: batch.waybillCount })}</div>
              <div>
                {t('detail.hubExit')}
                {batch.exitSettled ? t('detail.settled') : t('detail.notSettled')}
              </div>
              <div>
                {t('detail.dispatch')}
                {batch.dispatchSettled
                  ? t('detail.settled')
                  : batch.dispatchOverdue
                    ? t('detail.settleOverdue')
                    : t('detail.settling')}
              </div>
            </div>
          }
        >
          <Tag
            color={
              batch.dispatchSettled
                ? 'success'
                : batch.dispatchOverdue
                  ? 'error'
                  : batch.exitSettled
                    ? 'processing'
                    : 'default'
            }
            className="m-0 font-mono text-xs"
          >
            {batch.arrivalDate.slice(5)}
          </Tag>
        </Tooltip>
      ))}
    </div>
  )
}

export default function DispatchPerformanceDetailPage() {
  const { t } = useTranslation(['dispatchPerformance', 'common'])
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const v = useDispatchPerformanceDetailPage(id)
  const profitTrend = useProfitStabilityTrend({
    configId: id,
    startDate: v.range[0].format('YYYY-MM-DD'),
    endDate: v.range[1].format('YYYY-MM-DD'),
    whitelistMode: v.whitelistMode,
  })

  const config = v.result?.config
  const canPush = usePermission(PERMISSION_KEYS.btnDispatchPerformancePush)

  const [pushModalOpen, setPushModalOpen] = useState(false)
  const [rankingWeights, setRankingWeights] =
    useState<Record<DispatchRankingMetricKey, number>>(DEFAULT_DISPATCH_RANKING_WEIGHTS)
  const [exceptionPanelOpen, setExceptionPanelOpen] = useState(false)
  const [exceptionFilter, setExceptionFilter] = useState<
    { supplierKey?: string; routeCode?: string; courierCode?: string } | undefined
  >(undefined)

  const openExceptionPanel = (
    filter?: { supplierKey?: string; routeCode?: string; courierCode?: string },
  ) => {
    setExceptionFilter(filter)
    setExceptionPanelOpen(true)
  }

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div className="min-w-0">
            <Button
              type="link"
              className="!px-0"
              icon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => navigate('/dispatch-performance')}
            >
              {t('detail.backToList', { ns: 'dispatchPerformance' })}
            </Button>
            <h2 className="admin-title mt-1 flex flex-wrap items-center gap-2">
              {config?.stationName || config?.stationCode || t('detail.fallbackTitle', { ns: 'dispatchPerformance' })}
              {config ? (
                <span className="font-mono text-sm font-normal text-slate-400">
                  {config.stationCode}
                </span>
              ) : null}
              {config && !config.isEnabled ? (
                <Tag color="default">{t('detail.disabled', { ns: 'dispatchPerformance' })}</Tag>
              ) : null}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Popconfirm
              title={t('detail.settleNowConfirmTitle', { ns: 'dispatchPerformance' })}
              description={
                <div className="max-w-[320px] text-xs leading-relaxed">
                  {t('detail.settleNowConfirmDescPrefix', { ns: 'dispatchPerformance' })}
                  <b>{t('detail.settleNowConfirmDescBold', { ns: 'dispatchPerformance' })}</b>
                  {t('detail.settleNowConfirmDescSuffix', { ns: 'dispatchPerformance' })}
                </div>
              }
              okText={t('detail.startSettle', { ns: 'dispatchPerformance' })}
              cancelText={t('cancel', { ns: 'common' })}
              onConfirm={() => void v.settleNow()}
            >
              <Button
                type="primary"
                icon={<Zap className="h-4 w-4" />}
                loading={v.settling}
                disabled={config ? !config.isEnabled : true}
              >
                {t('detail.settleNow', { ns: 'dispatchPerformance' })}
              </Button>
            </Popconfirm>
            <Tooltip title={t('detail.refreshTooltip', { ns: 'dispatchPerformance' })}>
              <Button
                icon={<RefreshCw className="h-4 w-4" />}
                onClick={() => void v.reload()}
                loading={v.loading}
              >
                {t('detail.refresh', { ns: 'dispatchPerformance' })}
              </Button>
            </Tooltip>
            <Button
              icon={<Download className="h-4 w-4" />}
              disabled={!v.result}
              onClick={() =>
                v.result &&
                exportDispatchPerformanceToXlsx(v.result, v.whitelistMode, (key, opts) =>
                  t(key, { ns: 'dispatchPerformance', ...opts }),
                )
              }
            >
              {t('detail.exportButton', { ns: 'dispatchPerformance' })}
            </Button>
            <Tooltip title={!canPush ? t('push.noPermission', { ns: 'dispatchPerformance' }) : undefined}>
              <Button
                icon={<Send className="h-4 w-4" />}
                disabled={!canPush || !v.result}
                onClick={() => setPushModalOpen(true)}
              >
                {t('push.toolbarButton', { ns: 'dispatchPerformance' })}
              </Button>
            </Tooltip>
            <Button
              danger
              icon={<AlertTriangle className="h-4 w-4" />}
              disabled={!config}
              onClick={() => openExceptionPanel()}
            >
              {t('exception.toolbarButton', { ns: 'dispatchPerformance' })}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 px-6 py-4">
          <RangePicker
            value={v.range}
            onChange={(dates) => {
              if (dates?.[0] && dates?.[1]) v.setRange([dates[0], dates[1]] as [Dayjs, Dayjs])
            }}
            allowClear={false}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder={t('detail.allVendors', { ns: 'dispatchPerformance' })}
            value={v.supplierKeys}
            onChange={v.setSupplierKeys}
            options={(v.result?.supplierOptions ?? []).map((s) => ({
              label: s.supplierName,
              value: s.supplierKey,
            }))}
            className="min-w-[260px]"
            maxTagCount="responsive"
          />
          <Segmented<WhitelistMode>
            value={v.whitelistMode}
            onChange={v.setWhitelistMode}
            options={[
              { label: t('detail.whitelistModeExclude', { ns: 'dispatchPerformance' }), value: 'exclude' },
              { label: t('detail.whitelistModeInclude', { ns: 'dispatchPerformance' }), value: 'include' },
            ]}
          />
          {v.result ? (
            <SettleProgress batches={v.result.recentBatches} t={(key, opts) => t(key, { ns: 'dispatchPerformance', ...opts })} />
          ) : null}
        </div>
      </div>

      {v.error ? <Alert type="error" showIcon message={v.error} /> : null}
      {profitTrend.error ? <Alert type="error" showIcon message={profitTrend.error} /> : null}

      {v.settleResult ? (
        <SettleNowResult artifact={v.settleResult} onDismiss={v.dismissSettleResult} />
      ) : null}

      {v.result ? (
        <>
          <SummaryTiles
            overall={v.result.overall}
            t={(key, opts) => t(key, { ns: 'dispatchPerformance', ...opts })}
          />
          <SupplierRankingBoard
            suppliers={v.result.suppliers}
            weights={rankingWeights}
            onWeightsChange={setRankingWeights}
            onResetWeights={() => setRankingWeights(DEFAULT_DISPATCH_RANKING_WEIGHTS)}
          />
          <div className="admin-panel p-4">
            <PerformanceBreakdownTable
              suppliers={v.result.suppliers}
              loading={v.loading}
              dayCount={v.result.arrivalDates.length}
              onViewExceptions={openExceptionPanel}
            />
          </div>
          <UnmetParetoChart
            suppliers={v.result.suppliers}
            settled={v.result.overall.dispatchSettled}
          />
          <ProfitStabilityPanel
            result={profitTrend.result}
            loading={profitTrend.loading}
            dimension={profitTrend.dimension}
            onDimensionChange={profitTrend.setDimension}
            granularity={profitTrend.granularity}
            onGranularityChange={profitTrend.setGranularity}
            supplierOptions={v.result.supplierOptions}
            supplierKeys={profitTrend.supplierKeys}
            onSupplierKeysChange={profitTrend.setSupplierKeys}
          />
          <section className="admin-panel space-y-4 p-4">
            <div>
              <h3 className="admin-title text-xl">
                {t('attribution.title', { ns: 'dispatchPerformance' })}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {t('attribution.subtitle', { ns: 'dispatchPerformance' })}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <AttributionWaterfall
                title={t('attribution.priorityTitle', { ns: 'dispatchPerformance' })}
                settled={v.result.overall.dispatchSettled}
                input={{
                  total: v.result.overall.priorityTotal,
                  before11Met: v.result.overall.priorityBefore11Met,
                  nextDaySignMet: v.result.overall.priorityNextDaySignMet,
                  crossMet: v.result.overall.priorityExitMetNextDaySignMet,
                }}
              />
              <AttributionWaterfall
                title={t('attribution.overallTitle', { ns: 'dispatchPerformance' })}
                settled={v.result.overall.dispatchSettled}
                input={{
                  total: v.result.overall.total,
                  before11Met: v.result.overall.before11Met,
                  nextDaySignMet: v.result.overall.nextDaySignMet,
                  crossMet: v.result.overall.exitMetNextDaySignMet,
                }}
              />
            </div>
          </section>
        </>
      ) : null}

      {config ? (
        <DispatchExceptionPanel
          open={exceptionPanelOpen}
          onClose={() => setExceptionPanelOpen(false)}
          configId={config.id}
          range={v.range}
          supplierOptions={v.result?.supplierOptions ?? []}
          initialFilter={exceptionFilter}
          onChanged={() => void v.reload()}
        />
      ) : null}

      {config ? (
        <DispatchDataPushModal
          open={pushModalOpen}
          onClose={() => setPushModalOpen(false)}
          configId={config.id}
          stationName={config.stationName}
          startDate={v.range[0].format('YYYY-MM-DD')}
          endDate={v.range[1].format('YYYY-MM-DD')}
          suppliers={v.result?.suppliers ?? []}
          dayCount={v.result?.arrivalDates.length ?? 0}
          rankingWeights={rankingWeights}
        />
      ) : null}
    </div>
  )
}
