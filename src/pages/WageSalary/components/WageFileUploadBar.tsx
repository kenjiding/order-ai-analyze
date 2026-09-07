// @ts-nocheck
import { FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const VARIANT_STYLES = {
  attendance: {
    iconWrap: 'bg-[#e8f7f3] text-[#2f8f87]',
    primary: 'admin-btn admin-btn-primary',
  },
  finance: {
    iconWrap: 'bg-amber-50 text-amber-700',
    primary: 'admin-btn admin-btn-primary',
  },
}

/**
 * 工资页统一文件上传条：单行布局，减少空白与嵌套卡片。
 */
export function WageFileUploadBar({
  variant = 'attendance',
  title,
  description,
  accept = '.xlsx,.xls,.csv',
  sourceFileName,
  recordCount,
  onFileSelect,
  onClear,
  primaryAction,
  showClearWhenLoaded = true,
}) {
  const { t } = useTranslation('wageSalary')
  const styles = VARIANT_STYLES[variant] ?? VARIANT_STYLES.attendance
  const hasFile = Boolean(sourceFileName) || (recordCount != null && recordCount > 0)

  return (
    <div
      className={[
        'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 sm:px-4',
        hasFile ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50/60',
      ].join(' ')}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${styles.iconWrap}`}
        aria-hidden
      >
        <Upload className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-slate-900">{title}</span>
          {description && (
            <span className="text-xs text-slate-500 hidden sm:inline">· {description}</span>
          )}
        </div>
        {description && <p className="text-xs text-slate-500 sm:hidden mt-0.5">{description}</p>}
      </div>

      {sourceFileName ? (
        <div
          className="flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
          title={sourceFileName}
        >
          <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="truncate max-w-[12rem] sm:max-w-[18rem] font-medium">{sourceFileName}</span>
          {recordCount != null && recordCount > 0 && (
            <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
              {t('fileUpload.recordCount', { count: recordCount })}
            </span>
          )}
        </div>
      ) : recordCount != null && recordCount > 0 ? (
        <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500 tabular-nums ring-1 ring-slate-200">
          {t('fileUpload.recordCount', { count: recordCount })}
        </span>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="cursor-pointer">
          <span className="admin-btn py-1.5 px-3 text-xs sm:text-sm">
            <Upload className="h-3.5 w-3.5" />
            {hasFile ? t('fileUpload.replaceFile') : t('fileUpload.selectFile')}
          </span>
          <input type="file" accept={accept} onChange={onFileSelect} className="hidden" />
        </label>

        {primaryAction && hasFile && (
          <button
            type="button"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled || primaryAction.loading}
            className={`${styles.primary} py-1.5 px-3 text-xs sm:text-sm`}
          >
            {primaryAction.loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              primaryAction.icon
            )}
            {primaryAction.loading ? primaryAction.loadingLabel ?? primaryAction.label : primaryAction.label}
          </button>
        )}

        {showClearWhenLoaded && hasFile && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="admin-btn py-1.5 px-3 text-xs sm:text-sm text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
            {t('fileUpload.clear')}
          </button>
        )}
      </div>
    </div>
  )
}
