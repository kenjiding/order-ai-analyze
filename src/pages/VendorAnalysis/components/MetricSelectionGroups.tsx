import { Checkbox } from 'antd'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ALL_METRIC_KEYS,
  VENDOR_ANALYSIS_METRICS,
  getMetricLabel,
  type VendorMetricDef,
} from '../metricsRegistry'

type Props = {
  selection: string[]
  onChange: (next: string[]) => void
  aiSummaryEnabled: boolean
  onAiSummaryEnabledChange: (next: boolean) => void
}

function MetricGroup({
  title,
  metrics,
  selectionSet,
  onToggleMetric,
  extraItems,
  extraEnabledCount = 0,
  extraTotalCount = 0,
}: {
  title: string
  metrics: VendorMetricDef[]
  selectionSet: ReadonlySet<string>
  onToggleMetric: (key: string, next: boolean) => void
  extraItems?: ReactNode
  extraEnabledCount?: number
  extraTotalCount?: number
}) {
  const { t } = useTranslation('vendorAnalysis')
  const enabledCount = metrics.filter((m) => selectionSet.has(m.key)).length + extraEnabledCount
  const totalCount = metrics.length + extraTotalCount
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--admin-accent)]">{title}</span>
        <span className="text-[11px] tabular-nums text-slate-400">
          {t('enabledMetrics', { count: enabledCount, total: totalCount })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((metric) => {
          const checked = selectionSet.has(metric.key)
          return (
            <label
              key={metric.key}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                checked
                  ? 'border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] hover:bg-[var(--admin-accent-soft)]'
                  : 'border-[var(--admin-line)] bg-white hover:bg-slate-50'
              }`}
            >
              <Checkbox
                checked={checked}
                onChange={(e) => onToggleMetric(metric.key, e.target.checked)}
              >
                <span className="text-[13px] text-slate-700">{getMetricLabel(metric.key)}</span>
              </Checkbox>
            </label>
          )
        })}
        {extraItems}
      </div>
    </section>
  )
}

export function MetricSelectionGroups({
  selection,
  onChange,
  aiSummaryEnabled,
  onAiSummaryEnabledChange,
}: Props) {
  const { t } = useTranslation('vendorAnalysis')
  const vendorMetrics = VENDOR_ANALYSIS_METRICS.filter((m) => m.category === 'vendor')
  const driverMetrics = VENDOR_ANALYSIS_METRICS.filter((m) => m.category === 'driver')
  const moduleMetrics = VENDOR_ANALYSIS_METRICS.filter((m) => m.category === 'module')
  const selectionSet = useMemo(() => new Set(selection), [selection])

  const toggleMetric = (key: string, next: boolean) => {
    const set = new Set(selection)
    if (next) set.add(key)
    else set.delete(key)
    onChange(ALL_METRIC_KEYS.filter((k) => set.has(k)))
  }

  const aiItem = (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
        aiSummaryEnabled
          ? 'border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] hover:bg-[var(--admin-accent-soft)]'
          : 'border-[var(--admin-line)] bg-white hover:bg-slate-50'
      }`}
    >
      <Checkbox
        checked={aiSummaryEnabled}
        onChange={(e) => onAiSummaryEnabledChange(e.target.checked)}
      >
        <span className="text-[13px] text-slate-700">{t('aiSummary')}</span>
      </Checkbox>
    </label>
  )

  return (
    <div className="space-y-5">
      <MetricGroup
        title={t('metricGroups.vendor')}
        metrics={vendorMetrics}
        selectionSet={selectionSet}
        onToggleMetric={toggleMetric}
      />
      <MetricGroup
        title={t('metricGroups.driver')}
        metrics={driverMetrics}
        selectionSet={selectionSet}
        onToggleMetric={toggleMetric}
      />
      <MetricGroup
        title={t('metricGroups.modules')}
        metrics={moduleMetrics}
        selectionSet={selectionSet}
        onToggleMetric={toggleMetric}
        extraItems={aiItem}
        extraEnabledCount={aiSummaryEnabled ? 1 : 0}
        extraTotalCount={1}
      />
      <p className="text-[11px] leading-relaxed text-slate-400">
        {t('metricSelectionHint')}
      </p>
    </div>
  )
}
