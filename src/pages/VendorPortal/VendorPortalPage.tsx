import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Clock, Link2Off, Loader2, TrendingUp } from 'lucide-react'
import { LocaleSwitcher } from '../../components/I18n/LocaleSwitcher'
import { getDateTimeLocale } from '../../i18n'
import { useAppLocale, useVendorSnapshotTranslation } from '../../i18n/hooks'
import { Legend, VendorSection } from '../VendorAnalysis/components/snapshotSections'
import { fetchVendorPortalDaily, type VendorPortalDaily } from '../VendorAnalysis/vendorAnalysisApi'
import '../VendorAnalysis/vendorSnapshotPage.css'

/**
 * 供应商日报外部门户页：外部供应商凭分享链接（/vendor-daily/:token）访问，
 * 无登录态，只展示服务端切好的单供应商数据。
 */
export default function VendorPortalPage() {
  const { token } = useParams<{ token: string }>()
  const { t } = useVendorSnapshotTranslation()
  const { locale } = useAppLocale()
  const [data, setData] = useState<VendorPortalDaily | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(token ? 'loading' : 'error')

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetchVendorPortalDaily(token).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setData(result.data)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [token])

  if (status === 'loading') {
    return (
      <div className="vendor-snapshot-page min-h-screen bg-white">
        <div className="h-1.5 bg-indigo-600" />
        <div className="flex flex-col items-center justify-center gap-3 py-32">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" aria-hidden />
          <span className="text-sm text-slate-400">{t('portal.loading')}</span>
        </div>
      </div>
    )
  }

  if (status === 'error' || !data) {
    return (
      <div className="vendor-snapshot-page min-h-screen bg-white">
        <div className="h-1.5 bg-indigo-600" />
        <div className="mx-auto max-w-[560px] px-6 py-32 text-center">
          <Link2Off className="mx-auto mb-4 h-10 w-10 text-slate-200" aria-hidden />
          <h1 className="text-lg font-black text-slate-800">{t('portal.invalidTitle')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{t('portal.invalidHint')}</p>
        </div>
      </div>
    )
  }

  const generatedAt = new Date(data.generatedAt)
  const timeStr = generatedAt.toLocaleString(getDateTimeLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  // 优先当前语言，缺失时回退另一语言（外部页面不触发按需生成）
  const aiSummary = data.aiSummary?.[locale] ?? data.aiSummary?.['zh-CN'] ?? data.aiSummary?.en

  return (
    <div className="vendor-snapshot-page min-h-screen bg-white">
      {/* Top accent bar */}
      <div className="h-1.5 bg-indigo-600" />

      <div className="max-w-[980px] mx-auto px-4 py-4 sm:px-6 sm:py-7">
        {/* Header card */}
        <div className="mb-5 sm:mb-8 rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 sm:gap-6 items-start">
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs font-black uppercase tracking-[0.16em] sm:tracking-[0.2em] text-indigo-600 mb-2 sm:mb-3">
                {t('brand')}
              </div>
              <h1 className="text-2xl sm:text-[30px] font-black text-slate-900 leading-tight sm:leading-none">
                {t('title')}
              </h1>
              <div className="mt-1.5 text-sm font-semibold text-slate-500 break-words">{data.vendor.vendorName}</div>
              <div className="mt-3 sm:mt-4 flex flex-col min-[420px]:flex-row min-[420px]:flex-wrap gap-2 sm:gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600 w-fit max-w-full">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{t('header.referenceDate')} {data.reportDate}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600 w-fit max-w-full">
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{t('header.complaintStats')} {data.complaintDateRange}</span>
                </span>
              </div>
            </div>

            <div className="shrink-0 flex flex-col items-stretch gap-3 border-t border-slate-100 pt-4 md:border-t-0 md:pt-0 md:items-end">
              <LocaleSwitcher compact className="vs-locale-switch w-full md:w-auto md:justify-end" />
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Clock className="h-3 w-3 shrink-0" aria-hidden />
                <span>{t('header.generatedAt', { time: timeStr })}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Color legend */}
        <Legend />

        {/* Vendor section */}
        <VendorSection
          vendor={data.vendor}
          index={0}
          aiSummary={aiSummary}
          aiSummaryLoadingLabel={t('aiSummary.loading')}
          before11Date={data.before11Date}
          dispatch24hDate={data.dispatch24hDate}
          complaintDateRange={data.complaintDateRange}
        />

        {/* Footer */}
        <div className="mt-8 sm:mt-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-slate-200 pt-4 sm:pt-6">
          <span className="text-[11px] text-slate-400">{t('footer')}</span>
          <span className="text-[11px] text-slate-400 tabular-nums">{timeStr}</span>
        </div>
      </div>
    </div>
  )
}
