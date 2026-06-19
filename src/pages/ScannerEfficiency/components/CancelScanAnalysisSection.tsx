import { useMemo } from 'react'
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
}


export function CancelScanAnalysisSection({ analysis, loading, onFetch }: Props) {
  const totalWaybills = analysis?.meta.waybillFetched ?? 0

  const zoneCount = useMemo(
    () => (analysis?.routeCodeDistribution.length ? countRouteZones(analysis.routeCodeDistribution) : 0),
    [analysis?.routeCodeDistribution],
  )

  const statusItems = useMemo((): any[] => {
    if (!analysis) return []
    return [
      { label: '细分错误', value: formatInteger(analysis.meta.cancelScanFetched) },
      { label: '运单号', value: formatInteger(analysis.meta.waybillCount) },
      { label: '运单命中', value: formatInteger(analysis.meta.waybillFetched) },
      {
        label: '大区 / 路由码',
        value: `${formatInteger(zoneCount)} / ${formatInteger(analysis.routeCodeDistribution.length)}`,
      },
      {
        label: '区间',
        value: `${analysis.meta.startDate} ~ ${analysis.meta.endDate}`,
      },
    ]
  }, [analysis, zoneCount])

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
                获取细分错误率
              </Button>
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="cancel-scan-panel__loading">
          <span className="cancel-scan-panel__loading-dot" aria-hidden />
          正在拉取细分错误率数据…
        </div>
      )}

      {!loading && !analysis && !onFetch && (
        <div className="cancel-scan-panel__state">
          尚未载入数据。请在上方选择日期区间并点击「获取数据」。
        </div>
      )}

      {!loading && analysis && analysis.meta.cancelScanFetched === 0 && (
        <div className="cancel-scan-panel__state">
          所选区间内无细分错误记录（{analysis.meta.startDate} ~ {analysis.meta.endDate}）。
        </div>
      )}

      {!loading && analysis && analysis.meta.cancelScanFetched > 0 && analysis.meta.waybillCount === 0 && (
        <div className="cancel-scan-panel__state cancel-scan-panel__state--warn">
          已拉取 {formatInteger(analysis.meta.cancelScanFetched)} 条细分错误记录，但未识别到有效运单号。
        </div>
      )}

      {analysis && (analysis.routeCodeDistribution.length > 0 || analysis.dailyRouteCodeCounts?.length) && (
        <RouteCodeZoneBoard
          routeCodeDistribution={analysis.routeCodeDistribution}
          dailyRouteCodeCounts={analysis.dailyRouteCodeCounts}
          totalWaybills={totalWaybills}
        />
      )}

      {analysis &&
        analysis.meta.waybillCount > 0 &&
        !analysis.routeCodeDistribution.length &&
        !analysis.dailyRouteCodeCounts?.length &&
        !loading && (
        <div className="cancel-scan-panel__state cancel-scan-panel__state--warn">
          已查询 {formatInteger(analysis.meta.waybillCount)} 个运单号，运单信息未返回可统计的路由码。
        </div>
      )}
    </section>
  )
}
