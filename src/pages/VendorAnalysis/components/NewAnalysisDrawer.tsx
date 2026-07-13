import { Button, DatePicker, Drawer, Tooltip, Typography } from 'antd'
import type { Dayjs } from 'dayjs'
import {
  AlertTriangle,
  CalendarDays,
  DatabaseZap,
  ExternalLink,
  MapPin,
  SlidersHorizontal,
  Truck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  isSupplierPushEligible,
  SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH,
  SupplierPushSelectionGrid,
  type SupplierPushConfig,
} from '../../../shared/supplierPushConfig'
import { ALL_METRIC_KEYS, enabledDateSensitiveLabels } from '../metricsRegistry'
import { MetricSelectionGroups } from './MetricSelectionGroups'

type ScopeBindingLike = {
  enabledIds: string[]
  toggle: (configId: string, enabled: boolean) => unknown
  persist: (nextIds: string[]) => Promise<boolean>
  togglingId: string | null
  saving: boolean
  loading: boolean
}

type Props = {
  open: boolean
  onClose: () => void

  referenceDate: Dayjs | null
  onReferenceDateChange: (date: Dayjs | null) => void
  complaintDateRange: [Dayjs, Dayjs] | null
  onComplaintDateRangeChange: (range: [Dayjs, Dayjs] | null) => void

  metricSelection: string[]
  onMetricSelectionChange: (next: string[]) => void
  referenceDateIsToday: boolean

  aiSummaryEnabled: boolean
  onAiSummaryEnabledChange: (next: boolean) => void

  selectedStations: string[]

  catalogConfigs: SupplierPushConfig[]
  catalogLoading: boolean
  scopeBinding: ScopeBindingLike
  enabledPushCount: number

  dataFetching: boolean
  onStart: () => void
}

function FormSection({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--admin-line)] bg-white">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

/**
 * 「新建分析任务」抽屉：右侧弹出，集中配置一次分析所需的全部参数
 * （数据参考日期 / 客诉成立量时间 / 推送供应商配置 / 指标配置含扩展模块与 AI），
 * 点击「开始分析」提交并触发既有的异步获取数据流程。
 */
export function NewAnalysisDrawer({
  open,
  onClose,
  referenceDate,
  onReferenceDateChange,
  complaintDateRange,
  onComplaintDateRangeChange,
  metricSelection,
  onMetricSelectionChange,
  referenceDateIsToday,
  aiSummaryEnabled,
  onAiSummaryEnabledChange,
  selectedStations,
  catalogConfigs,
  catalogLoading,
  scopeBinding,
  enabledPushCount,
  dataFetching,
  onStart,
}: Props) {
  const hasStations = selectedStations.length > 0
  const filtersReady = !!referenceDate && !!complaintDateRange
  const canStart = filtersReady && hasStations && !dataFetching
  const allMetricsSelected = metricSelection.length === ALL_METRIC_KEYS.length

  // 参考日期非当天时，日期敏感指标（11点前出仓率/24H派签率）用当前时刻状态回填历史日期，可能不准确，
  // 仅在有勾选这类指标时给出提示，不阻止分析。
  const dateSensitiveLabels = useMemo(
    () => (referenceDateIsToday ? [] : enabledDateSensitiveLabels(metricSelection)),
    [referenceDateIsToday, metricSelection],
  )

  // 只有已配置 Webhook 的供应商才能被选中推送；未配置的置灰展示
  const eligibleConfigs = useMemo(
    () => catalogConfigs.filter(isSupplierPushEligible),
    [catalogConfigs],
  )
  const ineligibleCount = catalogConfigs.length - eligibleConfigs.length
  const eligibleIdSet = useMemo(() => new Set(eligibleConfigs.map((c) => c.id)), [eligibleConfigs])
  const enabledIdSet = useMemo(() => new Set(scopeBinding.enabledIds), [scopeBinding.enabledIds])
  const selectedPushCount = scopeBinding.enabledIds.filter((id) => eligibleIdSet.has(id)).length
  const allEligibleSelected = eligibleConfigs.length > 0 && selectedPushCount === eligibleConfigs.length

  // 默认全选：推送范围从未配置过（scope 为空）时，首次加载完成后自动选中全部可推送供应商，
  // 并落库以保持「多选组件展示」与「实际推送目标」一致。用户之后可自由增删（含清空）。
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current) return
    if (scopeBinding.loading || catalogLoading) return
    if (eligibleConfigs.length === 0) return
    initializedRef.current = true
    if (scopeBinding.enabledIds.length === 0) {
      void scopeBinding.persist(eligibleConfigs.map((c) => c.id))
    }
  }, [scopeBinding, catalogLoading, eligibleConfigs])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={740}
      maskClosable={!dataFetching}
      title={
        <div className="flex items-center gap-2">
          <DatabaseZap className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
          <span>新建分析任务</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            将统计 {selectedStations.length} 个责任站点 · 推送 {enabledPushCount} 个供应商
          </span>
          <div className="flex items-center gap-2">
            <Button size="small" onClick={onClose} disabled={dataFetching}>
              取消
            </Button>
            <Tooltip title={!hasStations ? '请先在顶部选择责任站点' : !filtersReady ? '请先选择日期' : ''}>
              <Button size="small"
                type="primary"
                icon={<DatabaseZap className="h-4 w-4" />}
                loading={dataFetching}
                disabled={!canStart}
                onClick={onStart}
              >
                {dataFetching ? '分析中…' : '开始分析'}
              </Button>
            </Tooltip>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {!hasStations && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <Typography.Text type="warning" className="text-xs leading-relaxed">
              尚未选择责任站点。请先在页面顶部的全局筛选中选择站点，否则无法开始分析。
            </Typography.Text>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <FormSection
            icon={CalendarDays}
            title="数据参考日期"
            description="作为「今天」推导昨天/前天，用于实时指标。"
          >
            <DatePicker
              value={referenceDate}
              onChange={(v) => onReferenceDateChange(v)}
              format="YYYY-MM-DD"
              allowClear
              className="w-full"
              placeholder="选择参考日期"
            />
          </FormSection>

          <FormSection
            icon={CalendarDays}
            title="客诉成立量时间"
            description="统计客诉率、应揽量的时间区间。"
          >
            <DatePicker.RangePicker
              value={complaintDateRange}
              onChange={(v) => onComplaintDateRangeChange(v as [Dayjs, Dayjs] | null)}
              format="YYYY-MM-DD"
              allowClear
              className="w-full"
              placeholder={['客诉开始日期', '客诉结束日期']}
            />
          </FormSection>
        </div>

        <FormSection
          icon={SlidersHorizontal}
          title="指标配置"
          description="勾选本次分析要抓取并展示的指标，默认全选。"
          action={
            <div className="flex items-center gap-2">
              <Button size="small"
                disabled={allMetricsSelected}
                onClick={() => onMetricSelectionChange([...ALL_METRIC_KEYS])}
              >
                全选
              </Button>
              <Button size="small" disabled={metricSelection.length === 0} onClick={() => onMetricSelectionChange([])}>
                清空
              </Button>
            </div>
          }
        >
          {dateSensitiveLabels.length > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              <Typography.Text type="warning" className="text-xs leading-relaxed">
                你所选的数据参考日期是以往日期，因此{dateSensitiveLabels.join('、')}会存在归班等数据, 从而会导致不准确的情况
              </Typography.Text>
            </div>
          )}
          <MetricSelectionGroups
            selection={metricSelection}
            onChange={onMetricSelectionChange}
            aiSummaryEnabled={aiSummaryEnabled}
            onAiSummaryEnabledChange={onAiSummaryEnabledChange}
          />
        </FormSection>

        <FormSection
          icon={Truck}
          title="推送供应商配置"
          description=""
          action={
            <div className="flex items-center gap-2">
              <Button size="small"
                disabled={scopeBinding.saving || allEligibleSelected || eligibleConfigs.length === 0}
                onClick={() => void scopeBinding.persist(eligibleConfigs.map((c) => c.id))}
              >
                全选
              </Button>
              <Button size="small"
                disabled={scopeBinding.saving || selectedPushCount === 0}
                onClick={() => void scopeBinding.persist([])}
              >
                清空
              </Button>
            </div>
          }
        >
          <SupplierPushSelectionGrid
            configs={catalogConfigs}
            enabledIdSet={enabledIdSet}
            togglingId={scopeBinding.togglingId}
            saving={scopeBinding.saving || scopeBinding.loading || catalogLoading}
            onToggle={(id, next) => void scopeBinding.toggle(id, next)}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--admin-line)] pt-3 text-[11px] text-slate-400">
            <span>已选 {selectedPushCount} / {eligibleConfigs.length} 个可推送供应商</span>
            <span className="flex items-center gap-3">
              {ineligibleCount > 0 && <span>{ineligibleCount} 个未配置 Webhook</span>}
              <Link to={SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH} className="inline-flex items-center gap-1 text-[var(--admin-accent)] hover:underline">
                <ExternalLink className="h-3 w-3" />维护配置
              </Link>
            </span>
          </div>
        </FormSection>
      </div>
    </Drawer>
  )
}
