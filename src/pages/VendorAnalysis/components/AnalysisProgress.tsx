import { Button } from 'antd'
import { AlertTriangle, RotateCw } from 'lucide-react'
import type { VendorAnalyzeJobProgress } from '../useVendorAnalysisPage'

/** 分析任务提交后的分步进度条（新建分析时在「分析任务」页展示） */
export function AnalysisProgressStrip({
  progress,
  reused,
}: {
  progress: VendorAnalyzeJobProgress | null
  reused: boolean
}) {
  const totalSteps = progress?.totalSteps ?? 7
  const step = progress?.step ?? 0
  const message = progress?.message ?? '正在提交任务'

  return (
    <div
      className="rounded-md border px-3 py-2.5"
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

/** 分析任务失败提示条，附「重新获取」入口 */
export function AnalysisErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-red-100 bg-red-50/60 px-3 py-2.5">
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
