import { Checkbox } from 'antd'
import { useMemo } from 'react'
import {
  ALL_METRIC_KEYS,
  VENDOR_ANALYSIS_METRICS,
  type VendorMetricDef,
} from '../metricsRegistry'

type Props = {
  /** 当前新建分析的指标选择（key 列表） */
  selection: string[]
  /** 勾选变化时回调，传入新的 key 列表（registry 顺序） */
  onChange: (next: string[]) => void
}

function MetricGroup({
  title,
  metrics,
  selectionSet,
  onToggleMetric,
}: {
  title: string
  metrics: VendorMetricDef[]
  selectionSet: ReadonlySet<string>
  onToggleMetric: (key: string, next: boolean) => void
}) {
  const enabledCount = metrics.filter((m) => selectionSet.has(m.key)).length
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--admin-accent)]">{title}</span>
        <span className="text-[11px] tabular-nums text-slate-400">
          已启用 {enabledCount} / {metrics.length}
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
                <span className="text-[13px] text-slate-700">{metric.label}</span>
              </Checkbox>
            </label>
          )
        })}
      </div>
    </section>
  )
}

/**
 * 指标勾选组（供应商 / 司机两组）。用于「新建分析任务」抽屉里的指标配置区块。
 * 勾选属于「本次新建分析」的本地选择，即时生效、不落库：点击「开始分析」时按此提交，
 * 决定后端抓取哪些数据源、以及生成结果按哪些指标展示。默认全选。
 * 所有指标（含「11点前出仓率」「24H派签率」等日期敏感指标）都可自由勾选/取消；
 * 日期敏感指标在参考日期非当天时可能不准确的提示，由抽屉统一给出。
 */
export function MetricSelectionGroups({ selection, onChange }: Props) {
  const vendorMetrics = VENDOR_ANALYSIS_METRICS.filter((m) => m.category === 'vendor')
  const driverMetrics = VENDOR_ANALYSIS_METRICS.filter((m) => m.category === 'driver')
  const selectionSet = useMemo(() => new Set(selection), [selection])

  const toggleMetric = (key: string, next: boolean) => {
    const set = new Set(selection)
    if (next) set.add(key)
    else set.delete(key)
    onChange(ALL_METRIC_KEYS.filter((k) => set.has(k)))
  }

  return (
    <div className="space-y-5">
      <MetricGroup
        title="供应商指标"
        metrics={vendorMetrics}
        selectionSet={selectionSet}
        onToggleMetric={toggleMetric}
      />
      <MetricGroup
        title="司机指标"
        metrics={driverMetrics}
        selectionSet={selectionSet}
        onToggleMetric={toggleMetric}
      />
      <p className="text-[11px] leading-relaxed text-slate-400">
        指标选择即时生效，点击「开始分析」时按此提交。
      </p>
    </div>
  )
}
