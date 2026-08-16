import { Checkbox } from 'antd'
import { useMemo, useState } from 'react'
import {
  DEFAULT_SANKEY_DIMS,
  EMPTY_SCOPE_DRILL,
  SANKEY_DIM_OPTIONS,
  buildSankeyGraph,
  buildInHubLossFlowTableRows,
  filterChartAnalytics,
  nextScopeDrillPath,
  resolveSankeyColumns,
  resolveScopeDrillView,
  type InHubLossAnalytics,
  type SankeyDimKey,
  type ScopeDrillPath,
} from '../inHubLossAnalytics'
import { InHubLossBarChart } from './InHubLossBarChart'
import { InHubLossFlowTable } from './InHubLossFlowTable'
import { InHubLossSankeyChart } from './InHubLossSankeyChart'

type Props = {
  analytics: InHubLossAnalytics
  minRouteCount: number
  excludedRouteCodes: string[]
}

export function InHubLossAnalyticsPanel({ analytics, minRouteCount, excludedRouteCodes }: Props) {
  const [selectedDims, setSelectedDims] = useState<SankeyDimKey[]>([...DEFAULT_SANKEY_DIMS])
  const [scopeDrill, setScopeDrill] = useState<ScopeDrillPath>(EMPTY_SCOPE_DRILL)
  const columns = useMemo(() => resolveSankeyColumns(selectedDims), [selectedDims])
  const chartAnalytics = useMemo(
    () => filterChartAnalytics(analytics, excludedRouteCodes, minRouteCount),
    [analytics, excludedRouteCodes, minRouteCount],
  )
  const graph = useMemo(
    () => buildSankeyGraph(chartAnalytics.flows, selectedDims),
    [chartAnalytics.flows, selectedDims],
  )
  const flowTableRows = useMemo(
    () => buildInHubLossFlowTableRows(chartAnalytics.flows, selectedDims),
    [chartAnalytics.flows, selectedDims],
  )
  const scopeDrillView = useMemo(
    () => resolveScopeDrillView(chartAnalytics, scopeDrill),
    [chartAnalytics, scopeDrill],
  )

  if (analytics.doneCount === 0) return null

  const noMatchingRoutes = analytics.flows.length > 0 && graph.links.length === 0 && selectedDims.length > 0

  return (
    <div className="package-loss-viz">
      <div className="package-loss-viz-block">
        <h3 className="package-loss-viz-title">库内丢失流向</h3>
        <div className="package-loss-sankey-toolbar">
          <div className="package-loss-sankey-filter">
            <span className="package-loss-sankey-filter-label">展示维度</span>
            <Checkbox.Group
              className="package-loss-sankey-filter-checks"
              value={selectedDims}
              options={SANKEY_DIM_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={(next) => setSelectedDims(next as SankeyDimKey[])}
              aria-label="选择桑基图展示维度"
            />
          </div>
        </div>
        {selectedDims.length === 0 ? (
          <p className="package-loss-viz-empty">请至少选择一个维度</p>
        ) : noMatchingRoutes ? (
          <p className="package-loss-viz-empty">没有可展示的路由码</p>
        ) : (
          <InHubLossSankeyChart graph={graph} columns={columns} />
        )}
        {flowTableRows.length > 0 ? (
          <InHubLossFlowTable columns={columns} rows={flowTableRows} />
        ) : null}
        {chartAnalytics.insight ? <p className="package-loss-viz-insight">{chartAnalytics.insight}</p> : null}
      </div>

      <div className="package-loss-viz-dims">
        <InHubLossBarChart
          title="判定构成"
          caption={scopeDrillView.caption}
          data={scopeDrillView.data}
          emptyText="暂无判定分布"
          ariaLabel={scopeDrillView.ariaLabel}
          crumbs={scopeDrillView.crumbs}
          onBarClick={
            scopeDrillView.canDrill
              ? (key) => setScopeDrill(nextScopeDrillPath(scopeDrillView.path, key))
              : undefined
          }
          onCrumbClick={setScopeDrill}
        />
        <InHubLossBarChart
          title="滞留天数"
          caption="仅库内丢失，按无操作天数"
          data={chartAnalytics.aging}
          emptyText="暂无库内丢失滞留分布"
          ariaLabel="库内丢失无操作天数分布"
        />
      </div>
    </div>
  )
}
