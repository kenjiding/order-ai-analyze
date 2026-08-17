import { InputNumber, Select, Tag, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import {
  DEFAULT_SANKEY_DIMS,
  EMPTY_SCOPE_DRILL,
  SANKEY_DIM_OPTIONS,
  buildSankeyGraph,
  buildInHubLossFlowTableRows,
  canonicalizeExcludedRouteCodes,
  filterChartAnalytics,
  filterFlowsBySubtypes,
  nextScopeDrillPath,
  resolveSankeyColumns,
  resolveScopeDrillView,
  uniqueRouteCodes,
  uniqueSubtypes,
  type InHubLossAnalytics,
  type SankeyDimKey,
  type ScopeDrillPath,
} from '../inHubLossAnalytics'
import { InHubLossBarChart } from './InHubLossBarChart'
import { InHubLossFlowTable } from './InHubLossFlowTable'
import { InHubLossSankeyChart } from './InHubLossSankeyChart'

const DEFAULT_MIN_ROUTE_COUNT = 2

type Props = {
  analytics: InHubLossAnalytics
}

export function InHubLossAnalyticsPanel({ analytics }: Props) {
  const [minRouteCount, setMinRouteCount] = useState(DEFAULT_MIN_ROUTE_COUNT)
  const [excludedRouteCodes, setExcludedRouteCodes] = useState<string[]>([])
  const [selectedDims, setSelectedDims] = useState<SankeyDimKey[]>([...DEFAULT_SANKEY_DIMS])
  const [selectedSubtypes, setSelectedSubtypes] = useState<string[] | null>(null)
  const [scopeDrill, setScopeDrill] = useState<ScopeDrillPath>(EMPTY_SCOPE_DRILL)
  const columns = useMemo(() => resolveSankeyColumns(selectedDims), [selectedDims])
  const chartAnalytics = useMemo(
    () => filterChartAnalytics(analytics, excludedRouteCodes, minRouteCount),
    [analytics, excludedRouteCodes, minRouteCount],
  )
  const routeCodeOptions = useMemo(() => uniqueRouteCodes(analytics.flows), [analytics.flows])
  const subtypeOptions = useMemo(() => uniqueSubtypes(chartAnalytics.flows), [chartAnalytics.flows])
  const effectiveSubtypes = useMemo(() => {
    if (subtypeOptions.length === 0) return []
    if (selectedSubtypes === null) return subtypeOptions
    const kept = selectedSubtypes.filter((name) => subtypeOptions.includes(name))
    if (kept.length === 0 && selectedSubtypes.length > 0) return subtypeOptions
    return kept
  }, [selectedSubtypes, subtypeOptions])
  const visibleFlows = useMemo(
    () => filterFlowsBySubtypes(chartAnalytics.flows, effectiveSubtypes),
    [chartAnalytics.flows, effectiveSubtypes],
  )
  const graph = useMemo(
    () => buildSankeyGraph(visibleFlows, selectedDims),
    [visibleFlows, selectedDims],
  )
  const flowTableRows = useMemo(
    () => buildInHubLossFlowTableRows(visibleFlows, selectedDims),
    [visibleFlows, selectedDims],
  )
  const scopeDrillView = useMemo(
    () => resolveScopeDrillView(chartAnalytics, scopeDrill),
    [chartAnalytics, scopeDrill],
  )

  if (analytics.doneCount === 0) return null

  const noMatchingRoutes = chartAnalytics.flows.length > 0 && graph.links.length === 0 && selectedDims.length > 0

  return (
    <div className="package-loss-viz">
      <div className="package-loss-viz-block">
        <div className="package-loss-viz-head">
          <div className="min-w-0">
            <h3 className="package-loss-viz-title">库内丢失流向</h3>
            <p className="package-loss-viz-caption">按路由、派件员与责任人看丢失集中在哪一段。</p>
          </div>
          <div className="package-loss-viz-filters">
            <div className="package-loss-field">
              <label className="package-loss-field-label" htmlFor="in-hub-min-route-count">
                <Tooltip title="例如 AA091 有 1 单、BB087 有 2 单。填 2 只显示 BB087。">
                  <span className="cursor-help">路由码丢失 ≥</span>
                </Tooltip>
              </label>
              <InputNumber
                id="in-hub-min-route-count"
                min={1}
                precision={0}
                value={minRouteCount}
                onChange={(value) => {
                  if (value == null) return
                  setMinRouteCount(Number(value))
                }}
                className="w-full"
                aria-label="路由码丢失数量下限"
              />
            </div>
            <div className="package-loss-field">
              <label className="package-loss-field-label" htmlFor="in-hub-exclude-routes">
                剔除路由码
              </label>
              <Select
                id="in-hub-exclude-routes"
                mode="tags"
                allowClear
                value={excludedRouteCodes}
                options={routeCodeOptions.map((code) => ({ value: code, label: code }))}
                onChange={(values) => {
                  setExcludedRouteCodes(canonicalizeExcludedRouteCodes(values, routeCodeOptions))
                }}
                tokenSeparators={[',', '，', ' ']}
                placeholder="输入或选择"
                className="w-full"
                aria-label="剔除路由码"
              />
            </div>
          </div>
        </div>

        {subtypeOptions.length > 0 ? (
          <div className="package-loss-chip-row">
            <span className="package-loss-chip-label">子类型</span>
            {subtypeOptions.map((name) => (
              <Tag.CheckableTag
                key={name}
                checked={effectiveSubtypes.includes(name)}
                onChange={(checked) => {
                  const current = effectiveSubtypes
                  setSelectedSubtypes(checked ? [...current, name] : current.filter((item) => item !== name))
                }}
                className="package-loss-chip"
              >
                {name}
              </Tag.CheckableTag>
            ))}
          </div>
        ) : null}

        <div className="package-loss-chip-row">
          <span className="package-loss-chip-label">展示维度</span>
          {SANKEY_DIM_OPTIONS.map((option) => (
            <Tag.CheckableTag
              key={option.value}
              checked={selectedDims.includes(option.value)}
              onChange={(checked) => {
                setSelectedDims((prev) =>
                  checked ? [...prev, option.value] : prev.filter((item) => item !== option.value),
                )
              }}
              className="package-loss-chip"
            >
              {option.label}
            </Tag.CheckableTag>
          ))}
        </div>

        {effectiveSubtypes.length === 0 && subtypeOptions.length > 0 ? (
          <p className="package-loss-viz-empty">请至少选择一个子类型</p>
        ) : selectedDims.length === 0 ? (
          <p className="package-loss-viz-empty">请至少选择一个维度</p>
        ) : noMatchingRoutes ? (
          <p className="package-loss-viz-empty">当前筛选下没有可展示的流向</p>
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
