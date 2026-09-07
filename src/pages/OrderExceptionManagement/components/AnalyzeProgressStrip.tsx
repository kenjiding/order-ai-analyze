import { useTranslation } from 'react-i18next'
import type { AnalyzeProgress } from '../analysisTypes'

type Props = {
  progress: AnalyzeProgress
  isAnalyzing: boolean
  /** 逐单模式为 true；批量模式完成后一次性展示 */
  incrementalResults?: boolean
  isPaused?: boolean
}

export function AnalyzeProgressStrip({
  progress,
  isAnalyzing,
  incrementalResults = true,
  isPaused = false,
}: Props) {
  const { t } = useTranslation('orderException')
  const remaining = Math.max(0, progress.total - progress.completed)
  const percent =
    progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0

  return (
    <div
      className="rounded-lg border border-slate-200/90 bg-gradient-to-br from-slate-50/90 to-[var(--admin-accent-soft)]/40 px-4 py-3.5"
      role="status"
      aria-live="polite"
      aria-label={t('progress.ariaLabel', {
        succeeded: progress.succeeded,
        remaining,
        total: progress.total,
      })}
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-700 shadow-sm">
          <span className="text-xs font-medium text-slate-500">{t('progress.total')}</span>
          <span className="font-semibold tabular-nums text-slate-900">{progress.total}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(47,143,135,0.25)] bg-[var(--admin-accent-soft)] px-2.5 py-1 text-sm text-[#1f6f68] shadow-sm">
          <span className="text-xs font-medium text-[#2f7a74]">{t('progress.analyzed')}</span>
          <span className="font-semibold tabular-nums">{progress.succeeded}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200/90 bg-amber-50 px-2.5 py-1 text-sm text-amber-900 shadow-sm">
          <span className="text-xs font-medium text-amber-700">{t('progress.remaining')}</span>
          <span className="font-semibold tabular-nums">{remaining}</span>
        </span>
        {progress.failed > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200/90 bg-red-50 px-2.5 py-1 text-sm text-red-800 shadow-sm">
            <span className="text-xs font-medium text-red-600">{t('progress.failed')}</span>
            <span className="font-semibold tabular-nums">{progress.failed}</span>
          </span>
        ) : null}
        {isPaused ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200/90 bg-amber-50 px-2.5 py-1 text-sm text-amber-900 shadow-sm">
            {t('progress.paused')}
          </span>
        ) : null}
        <span className="ml-auto text-xs font-medium tabular-nums text-slate-500">{percent}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80 ring-1 ring-slate-200/80">
        <div
          className="h-full rounded-full bg-[var(--admin-accent)] transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      {isAnalyzing ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          {isPaused
            ? t('progress.pausedHint')
            : incrementalResults
              ? t('progress.incrementalHint')
              : t('progress.batchHint')}
        </p>
      ) : null}
    </div>
  )
}
