import { InputNumber, Select, Tag, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_SANKEY_DIMS,
  EMPTY_SCOPE_DRILL,
  EMPTY_VENDOR_DRILL,
  buildSankeyGraph,
  buildInHubLossFlowTableRows,
  canonicalizeExcludedRouteCodes,
  filterChartAnalytics,
  filterFlowsBySubtypes,
  getSankeyDimOptions,
  nextScopeDrillPath,
  nextVendorDrillPath,
  resolveSankeyColumns,
  resolveScopeDrillView,
  resolveVendorDrillView,
  uniqueRouteCodes,
  uniqueSubtypes,
  type InHubLossAnalytics,
  type SankeyDimKey,
  type ScopeDrillPath,
  type VendorDrillPath,
} from '../inHubLossAnalytics'
import { InHubLossBarChart } from './InHubLossBarChart'
import { InHubLossFlowTable } from './InHubLossFlowTable'
import { InHubLossSankeyChart } from './InHubLossSankeyChart'

const DEFAULT_MIN_ROUTE_COUNT = 2

type Props = {
  analytics: InHubLossAnalytics
}

export function InHubLossAnalyticsPanel({ analytics }: Props) {
  const { t } = useTranslation('packageLoss')
  const [minRouteCount, setMinRouteCount] = useState(DEFAULT_MIN_ROUTE_COUNT)
  const [excludedRouteCodes, setExcludedRouteCodes] = useState<string[]>([])
  const [selectedDims, setSelectedDims] = useState<SankeyDimKey[]>([...DEFAULT_SANKEY_DIMS])
  const [selectedSubtypes, setSelectedSubtypes] = useState<string[] | null>(null)
  const [scopeDrill, setScopeDrill] = useState<ScopeDrillPath>(EMPTY_SCOPE_DRILL)
  const [vendorDrill, setVendorDrill] = useState<VendorDrillPath>(EMPTY_VENDOR_DRILL)
  const sankeyDimOptions = useMemo(() => getSankeyDimOptions(), [t])
  const columns = useMemo(() => resolveSankeyColumns(selectedDims), [selectedDims, t])
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
    [chartAnalytics, scopeDrill, t],
  )
  const vendorDrillView = useMemo(
    () => resolveVendorDrillView(chartAnalytics, vendorDrill),
    [chartAnalytics, vendorDrill, t],
  )

  if (analytics.doneCount === 0) return null

  const noMatchingRoutes = chartAnalytics.flows.length > 0 && graph.links.length === 0 && selectedDims.length > 0

  return (
    <div className="package-loss-viz">
      <div className="package-loss-viz-block">
        <div className="package-loss-viz-head">
          <div className="min-w-0">
            <h3 className="package-loss-viz-title">{t('panel.sankeyTitle')}</h3>
            <p className="package-loss-viz-caption">{t('panel.sankeyCaption')}</p>
          </div>
          <div className="package-loss-viz-filters">
            <div className="package-loss-field">
              <label className="package-loss-field-label" htmlFor="in-hub-min-route-count">
                <Tooltip title={t('panel.minRouteTooltip')}>
                  <span className="cursor-help">{t('panel.minRouteLabel')}</span>
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
                aria-label={t('panel.minRouteCount')}
              />
            </div>
            <div className="package-loss-field">
              <label className="package-loss-field-label" htmlFor="in-hub-exclude-routes">
                {t('panel.excludeRoutes')}
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
                placeholder={t('panel.excludeRoutesPlaceholder')}
                className="w-full"
                aria-label={t('panel.excludeRoutes')}
              />
            </div>
          </div>
        </div>

        {subtypeOptions.length > 0 ? (
          <div className="package-loss-chip-row">
            <span className="package-loss-chip-label">{t('panel.subtypeLabel')}</span>
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
          <span className="package-loss-chip-label">{t('panel.displayDims')}</span>
          {sankeyDimOptions.map((option) => (
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
          <p className="package-loss-viz-empty">{t('panel.selectSubtype')}</p>
        ) : selectedDims.length === 0 ? (
          <p className="package-loss-viz-empty">{t('panel.selectDim')}</p>
        ) : noMatchingRoutes ? (
          <p className="package-loss-viz-empty">{t('panel.noFlowsUnderFilter')}</p>
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
          title={t('panel.scopeChart')}
          caption={scopeDrillView.caption}
          data={scopeDrillView.data}
          emptyText={t('panel.emptyScopeDistribution')}
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
          title={t('panel.vendorLossTitle')}
          caption={vendorDrillView.caption}
          data={vendorDrillView.data}
          emptyText={t('panel.emptyVendorDistribution')}
          ariaLabel={vendorDrillView.ariaLabel}
          crumbs={vendorDrillView.crumbs}
          vertical
          colorByKey
          onBarClick={
            vendorDrillView.canDrill
              ? (key) => setVendorDrill(nextVendorDrillPath(vendorDrillView.path, key))
              : undefined
          }
          onCrumbClick={setVendorDrill}
        />
      </div>
    </div>
  )
}
