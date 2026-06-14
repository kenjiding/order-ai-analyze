import { useMemo } from 'react'
import { formatInteger } from '../formatAndParse'
import type { CancelScanAnalysisState } from '../cancelScanAnalysisTypes'
import { countRouteZones } from '../cancelScanRouteZoneTable'
import { RouteCodeZoneBoard } from './RouteCodeZoneBoard'
import './cancelScanAnalysis.css'

type Props = {
  analysis: CancelScanAnalysisState | null
  loading: boolean
}

type StatusItem = {
  label: string
  value: string
}

function StatusStrip({ items }: { items: StatusItem[] }) {
  return (
    <div className="cancel-scan-panel__status">
      {items.map((item, index) => (
        <span key={item.label} className="inline-flex items-center gap-3">
          {index > 0 ? <span className="cancel-scan-panel__status-divider" aria-hidden /> : null}
          <span>
            {item.label} <strong>{item.value}</strong>
          </span>
        </span>
      ))}
    </div>
  )
}

export function CancelScanAnalysisSection({ analysis, loading }: Props) {
  const totalWaybills = analysis?.meta.waybillFetched ?? 0

  const zoneCount = useMemo(
    () => (analysis?.routeCodeDistribution.length ? countRouteZones(analysis.routeCodeDistribution) : 0),
    [analysis?.routeCodeDistribution],
  )

  const statusItems = useMemo((): StatusItem[] => {
    if (!analysis) return []
    return [
      { label: '取消扫描', value: formatInteger(analysis.meta.cancelScanFetched) },
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
      {loading && (
        <div className="cancel-scan-panel__loading">
          <span className="cancel-scan-panel__loading-dot" aria-hidden />
          正在拉取取消扫描与运单信息…
        </div>
      )}

      {!loading && !analysis && (
        <div className="cancel-scan-panel__state">
          尚未载入数据。请在上方选择日期区间并点击「获取数据」。
        </div>
      )}

      {!loading && analysis && analysis.meta.cancelScanFetched === 0 && (
        <div className="cancel-scan-panel__state">
          所选区间内无取消扫描记录（{analysis.meta.startDate} ~ {analysis.meta.endDate}）。
        </div>
      )}

      {!loading && analysis && analysis.meta.cancelScanFetched > 0 && analysis.meta.waybillCount === 0 && (
        <div className="cancel-scan-panel__state cancel-scan-panel__state--warn">
          已拉取 {formatInteger(analysis.meta.cancelScanFetched)} 条取消扫描记录，但未识别到有效运单号。
        </div>
      )}

      {analysis && analysis.meta.cancelScanFetched > 0 && statusItems.length > 0 && (
        <StatusStrip items={statusItems} />
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
