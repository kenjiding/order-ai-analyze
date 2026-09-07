import { Button } from 'antd'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** 分析任务失败提示条，附「重新获取」入口 */
export function AnalysisErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useTranslation('vendorAnalysis')
  const { t: tc } = useTranslation('common')
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-red-100 bg-red-50/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-red-700">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t('fetchFailed', { error })}</span>
      </div>
      <Button type="text" icon={<RotateCw className="h-3.5 w-3.5" />} onClick={onRetry} className="text-red-600 hover:!text-red-700">
        {tc('retryFetch')}
      </Button>
    </div>
  )
}
