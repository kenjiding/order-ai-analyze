import { Checkbox, Tooltip } from 'antd'
import { useMemo } from 'react'
import {
  ALL_METRIC_KEYS,
  DATE_SENSITIVE_METRIC_KEYS,
  VENDOR_ANALYSIS_METRICS,
  type VendorMetricDef,
} from '../metricsRegistry'

type Props = {
  /** 当前新建分析的指标选择（key 列表） */
  selection: string[]
  /** 勾选变化时回调，传入新的 key 列表（registry 顺序） */
  onChange: (next: string[]) => void
  /** 数据参考日期是否为当天；决定日期敏感指标（11点前出仓率/24H派签率）能否被重新勾选 */
  referenceDateIsToday: boolean
}

function MetricGroup({
  title,
  metrics,
  selectionSet,
  referenceDateIsToday,
  onToggleMetric,
}: {
  title: string
  metrics: VendorMetricDef[]
  selectionSet: ReadonlySet<string>
  referenceDateIsToday: boolean
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
          // 日期敏感指标：非当天时只能取消勾选（隐藏），不能从未勾选状态重新勾选去补拉数据
          const dateLocked = !checked && !referenceDateIsToday && DATE_SENSITIVE_METRIC_KEYS.has(metric.key)
          const checkboxNode = (
            <Checkbox
              checked={checked}
              disabled={dateLocked}
              onChange={(e) => onToggleMetric(metric.key, e.target.checked)}
            >
              <span className={`text-[13px] ${dateLocked ? 'text-slate-500' : 'text-slate-700'}`}>
                {metric.label}
              </span>
            </Checkbox>
          )
          return (
            <label
              key={metric.key}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                dateLocked
                  ? 'cursor-default border-[var(--admin-line)] bg-[var(--admin-surface-soft)]'
                  : checked
                    ? 'cursor-pointer border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] hover:bg-[var(--admin-accent-soft)]'
                    : 'cursor-pointer border-[var(--admin-line)] bg-white hover:bg-slate-50'
              }`}
            >
              {dateLocked ? (
                // 用 span 包一层承接 hover：Checkbox disabled 后自身的 pointer-events 会被禁用，
                // 直接把 Tooltip 挂在它上面不会触发
                <Tooltip title="该指标反映抓取当刻的实时状态，仅数据参考日期为今天时才能勾选获取">
                  <span className="inline-flex">{checkboxNode}</span>
                </Tooltip>
              ) : (
                checkboxNode
              )}
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
 * 「11点前出仓率」「24H派签率」等日期敏感指标在数据参考日期不是当天时不能重新勾选
 * （只能取消勾选隐藏），详见 metricsRegistry.ts 的 dateSensitive。
 */
export function MetricSelectionGroups({ selection, onChange, referenceDateIsToday }: Props) {
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
        referenceDateIsToday={referenceDateIsToday}
        onToggleMetric={toggleMetric}
      />
      <MetricGroup
        title="司机指标"
        metrics={driverMetrics}
        selectionSet={selectionSet}
        referenceDateIsToday={referenceDateIsToday}
        onToggleMetric={toggleMetric}
      />
      <p className="text-[11px] leading-relaxed text-slate-400">
        指标选择即时生效，点击「开始分析」时按此提交。「11点前出仓率」「24H派签率」仅数据参考日期为今天时可勾选，非当天只能取消勾选隐藏。
      </p>
    </div>
  )
}
