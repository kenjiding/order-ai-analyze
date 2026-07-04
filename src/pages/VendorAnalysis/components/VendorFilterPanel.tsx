import { Button, DatePicker, Tag } from 'antd'
import type { Dayjs } from 'dayjs'
import type { ReactNode } from 'react'
import { AlertTriangle, CalendarDays, CheckCircle2, DatabaseZap, RotateCw } from 'lucide-react'
import type { FetchedData, VendorAnalyzeJobProgress } from '../useVendorAnalysisPage'

type Props = {
  referenceDate: Dayjs | null
  onReferenceDateChange: (date: Dayjs | null) => void
  complaintDateRange: [Dayjs, Dayjs] | null
  onComplaintDateRangeChange: (range: [Dayjs, Dayjs] | null) => void
  fetchedData: FetchedData | null
  dataFetching: boolean
  onFetchData: () => void
  jobProgress: VendorAnalyzeJobProgress | null
  jobError: string | null
  jobReused: boolean
  /** 渲染在「获取数据」按钮同行末尾的附加控件（指标配置入口） */
  extra?: ReactNode
  /** 已获取数据后新勾选、但缺少数据源的指标名称，非空时提示重新获取 */
  missingMetricLabels?: string[]
}

function ProgressStrip({ progress, reused }: { progress: VendorAnalyzeJobProgress | null; reused: boolean }) {
  const totalSteps = progress?.totalSteps ?? 7
  const step = progress?.step ?? 0
  const message = progress?.message ?? '正在提交任务'

  return (
    <div
      className="mt-3 rounded-md border px-3 py-2.5"
      style={{ borderColor: 'var(--admin-line)', background: 'var(--admin-surface-soft)' }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={totalSteps}
      aria-valuenow={step}
    >
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-600">
          {reused ? `沿用了已有任务的进度 · ${message}` : message}
        </span>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400">
          {step > 0 ? `${step} / ${totalSteps}` : '排队中'}
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors duration-500"
            style={{
              background:
                i < step ? 'var(--admin-accent)' : i === step ? 'var(--admin-accent-soft)' : 'var(--admin-line)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

function ErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-red-100 bg-red-50/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-red-700">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>数据获取失败：{error}</span>
      </div>
      <Button type="text" icon={<RotateCw className="h-3.5 w-3.5" />} onClick={onRetry} className="text-red-600 hover:!text-red-700">
        重新获取
      </Button>
    </div>
  )
}

export function VendorFilterPanel({
  referenceDate,
  onReferenceDateChange,
  complaintDateRange,
  onComplaintDateRangeChange,
  fetchedData,
  dataFetching,
  onFetchData,
  jobProgress,
  jobError,
  jobReused,
  extra,
  missingMetricLabels = [],
}: Props) {
  const fetchedTime = fetchedData
    ? `${fetchedData.fetchedAt.getHours().toString().padStart(2, '0')}:${fetchedData.fetchedAt.getMinutes().toString().padStart(2, '0')}`
    : null
  const filtersReady = !!referenceDate && !!complaintDateRange

  return (
    <div className="admin-panel">
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--admin-accent)]">
            筛选条件
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <CalendarDays className="h-3.5 w-3.5" />
              数据参考日期
            </label>
            <DatePicker
              value={referenceDate}
              onChange={(v) => onReferenceDateChange(v)}
              format="YYYY-MM-DD"
              allowClear
              className="w-40"
              placeholder="选择参考日期"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <CalendarDays className="h-3.5 w-3.5 text-amber-500" />
              客诉成立量时间
            </label>
            <DatePicker.RangePicker
              value={complaintDateRange}
              onChange={(v) => onComplaintDateRangeChange(v as [Dayjs, Dayjs] | null)}
              format="YYYY-MM-DD"
              allowClear
              className="w-64"
              placeholder={['客诉开始日期', '客诉结束日期']}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1 text-xs font-medium text-transparent select-none">
              &nbsp;
            </label>
            <Button
              type="primary"
              icon={<DatabaseZap className="h-4 w-4" />}
              loading={dataFetching}
              disabled={!filtersReady}
              onClick={onFetchData}
            >
              {dataFetching ? '获取中…' : '获取数据'}
            </Button>
          </div>

          {extra && (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1 text-xs font-medium text-transparent select-none">
                &nbsp;
              </label>
              {extra}
            </div>
          )}
        </div>

        {!dataFetching && missingMetricLabels.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              新勾选的指标（{missingMetricLabels.join('、')}）缺少数据，请重新点击「获取数据」。
            </span>
          </div>
        )}

        {dataFetching && <ProgressStrip progress={jobProgress} reused={jobReused} />}

        {!dataFetching && jobError && <ErrorBanner error={jobError} onRetry={onFetchData} />}

        {!dataFetching && !jobError && fetchedData && referenceDate && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-xs text-slate-500">{fetchedTime} 获取成功：</span>
            <Tag color="purple" className="text-xs">
              参考日期 {referenceDate.format('YYYY-MM-DD')}
              <span className="ml-1 text-slate-400">
                （昨天 {fetchedData.before11Date}）
              </span>
            </Tag>
            <Tag color="blue" className="text-xs">
              运单 {fetchedData.waybills.length} 条
              <span className="ml-1 text-slate-400">
                ({fetchedData.startTime.slice(0, 10)} ~ {fetchedData.endTime.slice(0, 10)})
              </span>
            </Tag>
            <Tag color="orange" className="text-xs">
              客诉 {fetchedData.tickets.length} 条
            </Tag>
          </div>
        )}
      </div>
    </div>
  )
}
