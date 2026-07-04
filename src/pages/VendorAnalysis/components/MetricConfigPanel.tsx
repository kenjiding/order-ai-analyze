import { Button, Checkbox, Drawer, Switch, Tag, Tooltip } from 'antd'
import { SlidersHorizontal, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  DATE_SENSITIVE_METRIC_KEYS,
  VENDOR_ANALYSIS_METRICS,
  resolveEnabledMetricKeys,
  type MetricPreferencesValue,
  type VendorMetricDef,
} from '../metricsRegistry'

type Props = {
  loading: boolean
  saving: boolean
  /** 已应用的偏好；打开侧边栏时以此初始化草稿 */
  value: MetricPreferencesValue
  /** 点击「保存」时调用；返回是否成功（成功则关闭侧边栏） */
  onSave: (next: MetricPreferencesValue) => Promise<boolean>
  /** 数据参考日期是否为当天；决定日期敏感指标（11点前出仓率/24H派签率）能否被重新勾选 */
  referenceDateIsToday: boolean
}

function MetricGroup({
  title,
  metrics,
  enabledSet,
  referenceDateIsToday,
  onToggleMetric,
}: {
  title: string
  metrics: VendorMetricDef[]
  enabledSet: ReadonlySet<string>
  referenceDateIsToday: boolean
  onToggleMetric: (key: string, next: boolean) => void
}) {
  const enabledCount = metrics.filter((m) => m.fixed || enabledSet.has(m.key)).length
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--admin-accent)]">{title}</span>
        <span className="text-[11px] tabular-nums text-slate-400">
          已启用 {enabledCount} / {metrics.length}
        </span>
      </div>
      <div className="divide-y divide-[var(--admin-line)] rounded-lg border border-[var(--admin-line)] overflow-hidden">
        {metrics.map((metric) => {
          const checked = metric.fixed || enabledSet.has(metric.key)
          // 日期敏感指标：非当天时只能取消勾选（隐藏），不能从未勾选状态重新勾选去补拉数据
          const dateLocked = !metric.fixed && !checked && !referenceDateIsToday && DATE_SENSITIVE_METRIC_KEYS.has(metric.key)
          const checkboxNode = (
            <Checkbox
              checked={checked}
              disabled={metric.fixed || dateLocked}
              onChange={(e) => onToggleMetric(metric.key, e.target.checked)}
            >
              <span className={`text-[13px] ${metric.fixed || dateLocked ? 'text-slate-500' : 'text-slate-700'}`}>
                {metric.label}
              </span>
            </Checkbox>
          )
          return (
            <label
              key={metric.key}
              className={`flex items-center justify-between gap-3 px-3 py-2.5 transition-colors ${
                metric.fixed || dateLocked
                  ? 'cursor-default bg-[var(--admin-surface-soft)]'
                  : 'cursor-pointer bg-white hover:bg-slate-50 active:bg-slate-100'
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
              {metric.fixed && (
                <Tag className="mr-0 border-0 bg-slate-200/60 text-[11px] text-slate-500" bordered={false}>
                  固定
                </Tag>
              )}
            </label>
          )
        })}
      </div>
    </section>
  )
}

/**
 * 指标配置入口 + 右侧配置侧边栏。
 * 侧边栏内的勾选/开关只改草稿，点击「保存」才写入服务端并应用到页面
 * （数据抓取范围、预览/落地页/门户渲染、AI 分析输入随之生效）。
 * 所有指标均可自由勾选/取消，无强制常开的固定指标；但「11点前出仓率」「24H派签率」两个日期敏感指标
 * 在数据参考日期不是当天时不能重新勾选（只能取消勾选隐藏），详见 metricsRegistry.ts 的 dateSensitive。
 */
export function MetricConfigPanel({ loading, saving, value, onSave, referenceDateIsToday }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<MetricPreferencesValue>(value)

  const vendorMetrics = VENDOR_ANALYSIS_METRICS.filter((m) => m.category === 'vendor')
  const driverMetrics = VENDOR_ANALYSIS_METRICS.filter((m) => m.category === 'driver')

  const draftEnabledSet = useMemo(() => new Set(resolveEnabledMetricKeys(draft)), [draft])
  // 以「生效结果」判断是否有未保存更改（勾掉再勾回 = 无变化）
  const dirty = useMemo(() => {
    const applied = resolveEnabledMetricKeys(value)
    return (
      draft.aiSummaryEnabled !== value.aiSummaryEnabled ||
      resolveEnabledMetricKeys(draft).join(',') !== applied.join(',')
    )
  }, [draft, value])

  const openDrawer = () => {
    setDraft(value)
    setOpen(true)
  }

  const toggleMetric = (key: string, next: boolean) => {
    setDraft((prev) => ({ ...prev, overrides: { ...prev.overrides, [key]: next } }))
  }

  const handleSave = async () => {
    const ok = await onSave(draft)
    if (ok) setOpen(false)
  }

  return (
    <>
      <Button icon={<SlidersHorizontal className="h-4 w-4" />} loading={loading} onClick={openDrawer}>
        指标配置
      </Button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        placement="right"
        width="min(92vw, 400px)"
        closable={!saving}
        maskClosable={!saving}
        title={
          <div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
              <span>指标配置</span>
            </div>
          </div>
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-400">
              {dirty ? '有未保存的更改' : ' '}
            </span>
            <div className="flex items-center gap-2">
              <Button disabled={saving} onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void handleSave()}>
                保存
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-6">
          <MetricGroup
            title="供应商指标"
            metrics={vendorMetrics}
            enabledSet={draftEnabledSet}
            referenceDateIsToday={referenceDateIsToday}
            onToggleMetric={toggleMetric}
          />

          <MetricGroup
            title="司机指标"
            metrics={driverMetrics}
            enabledSet={draftEnabledSet}
            referenceDateIsToday={referenceDateIsToday}
            onToggleMetric={toggleMetric}
          />

          <section>
            <div className="mb-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-[var(--admin-accent)]">
                AI 分析
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--admin-line)] bg-white px-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--admin-accent)]" aria-hidden />
                  AI 分析总结
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  关闭后生成快照时不再调用 AI，落地页不展示分析段落
                </p>
              </div>
              <Switch
                checked={draft.aiSummaryEnabled}
                onChange={(next) => setDraft((prev) => ({ ...prev, aiSummaryEnabled: next }))}
              />
            </div>
          </section>

          <p className="border-t border-[var(--admin-line)] pt-3 text-[11px] leading-relaxed text-slate-400">
            点击「保存」后新配置生效；勾选新指标后需重新「获取数据」。「11点前出仓率」「24H派签率」仅数据参考日期为今天时可勾选，非当天只能取消勾选隐藏。
          </p>
        </div>
      </Drawer>
    </>
  )
}
