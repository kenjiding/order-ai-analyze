import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import { CloudDownload } from 'lucide-react'
import { formatInteger } from '../formatAndParse'
import type { CancelScanAnalysisState } from '../cancelScanAnalysisTypes'
import { countRouteZones } from '../cancelScanRouteZoneTable'
import { RouteCodeZoneBoard } from './RouteCodeZoneBoard'
import './cancelScanAnalysis.css'

type Props = {
  analysis: CancelScanAnalysisState | null
  loading: boolean
  onFetch?: () => void
  zoneInboundScanTotals?: ReadonlyMap<string, number> | null
}


export function CancelScanAnalysisSection({ analysis, loading, onFetch, zoneInboundScanTotals }: Props) {
  const { t } = useTranslation('scannerEfficiency')
  const totalWaybills = analysis?.meta.waybillFetched ?? 0

  const zoneCount = useMemo(
    () => (analysis?.routeCodeDistribution.length ? countRouteZones(analysis.routeCodeDistribution) : 0),
    [analysis?.routeCodeDistribution],
  )

  const statusItems = useMemo((): any[] => {
    if (!analysis) return []
    return [
      { label: t('cancelScan.cancelScan'), value: formatInteger(analysis.meta.cancelScanFetched) },
      { label: t('cancelScan.waybillCount'), value: formatInteger(analysis.meta.waybillCount) },
      { label: t('cancelScan.waybillHit'), value: formatInteger(analysis.meta.waybillFetched) },
      {
        label: t('cancelScan.zoneRoute'),
        value: `${formatInteger(zoneCount)} / ${formatInteger(analysis.routeCodeDistribution.length)}`,
      },
      {
        label: t('cancelScan.range'),
        value: `${analysis.meta.startDate} ~ ${analysis.meta.endDate}`,
      },
    ]
  }, [analysis, zoneCount, t])

  return (
    <section className="cancel-scan-panel">
      {/* 按钮与状态数据同行 */}
      {(onFetch || statusItems.length > 0) && (
        <div className="cancel-scan-panel__status">
          {statusItems.map((item, index) => (
            <span key={item.label} className="inline-flex items-center gap-3">
              {index > 0 && (
                <span className="cancel-scan-panel__status-divider" aria-hidden />
              )}
              <span>
                {item.label} <strong>{item.value}</strong>
              </span>
            </span>
          ))}
          {onFetch && (
            <span className="ml-auto inline-flex items-center">
              <Button
                type="primary"
                icon={<CloudDownload className="h-4 w-4" aria-hidden />}
                loading={loading}
                disabled={loading}
                onClick={onFetch}
              >
                {t('cancelScan.fetch')}
              </Button>
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="cancel-scan-panel__loading">
          <span className="cancel-scan-panel__loading-dot" aria-hidden />
          {t('cancelScan.loading')}
        </div>
      )}

      {!loading && !analysis && !onFetch && (
        <div className="cancel-scan-panel__state">
          {t('cancelScan.emptyHintPrefix', { action: t('cancelScan.fetch') })}
        </div>
      )}

      {!loading && analysis && analysis.meta.cancelScanFetched === 0 && (
        <div className="cancel-scan-panel__state">
          {t('cancelScan.noRecords', { start: analysis.meta.startDate, end: analysis.meta.endDate })}
        </div>
      )}

      {!loading && analysis && analysis.meta.cancelScanFetched > 0 && analysis.meta.waybillCount === 0 && (
        <div className="cancel-scan-panel__state cancel-scan-panel__state--warn">
          {t('cancelScan.noWaybill', { count: formatInteger(analysis.meta.cancelScanFetched) })}
        </div>
      )}

      {analysis && (analysis.routeCodeDistribution.length > 0 || analysis.dailyRouteCodeCounts?.length) && (
        <RouteCodeZoneBoard
          routeCodeDistribution={analysis.routeCodeDistribution}
          dailyRouteCodeCounts={analysis.dailyRouteCodeCounts}
          totalWaybills={totalWaybills}
          zoneInboundScanTotals={zoneInboundScanTotals}
        />
      )}

      {analysis &&
        analysis.meta.waybillCount > 0 &&
        !analysis.routeCodeDistribution.length &&
        !analysis.dailyRouteCodeCounts?.length &&
        !loading && (
        <div className="cancel-scan-panel__state cancel-scan-panel__state--warn">
          {t('cancelScan.noRouteCodes', { count: formatInteger(analysis.meta.waybillCount) })}
        </div>
      )}
    </section>
  )
}
