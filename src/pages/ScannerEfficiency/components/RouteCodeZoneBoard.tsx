import { InputNumber } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { formatInteger, formatNumber } from '../formatAndParse'
import type { DailyRouteCodeCount } from '../cancelScanAnalysisTypes'
import type { RouteCodeDistributionItem } from '../scannerEfficiencyApi'
import {
  countHiddenRouteCodeFilterEntries,
  resolveFilteredRouteCodeDistribution,
} from '../cancelScanRouteCodeDaily'
import { buildRouteZoneGroups, buildRouteZoneGroupsFromDaily, attachZoneInboundScanTotals, type RouteZoneGroup } from '../cancelScanRouteZoneTable'
import { getZoneColorTheme, zoneThemeStyle } from '../cancelScanZoneColors'
import CancelScanZoneBarChart from '../CancelScanZoneBarChart'
import './cancelScanAnalysis.css'

type Props = {
  routeCodeDistribution: RouteCodeDistributionItem[]
  dailyRouteCodeCounts?: DailyRouteCodeCount[]
  totalWaybills: number
  zoneInboundScanTotals?: ReadonlyMap<string, number> | null
}

function formatShare(value: number): string {
  return `${formatNumber(value * 100, 1)}%`
}

function formatScanDateMonthDay(dateKey: string): string {
  const matched = dateKey.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!matched) return dateKey
  return `${Number(matched[2])}/${Number(matched[3])}`
}

function formatDailyCountsInline(dailyCounts: { date: string; count: number }[]): string {
  return dailyCounts
    .map((day) => `${formatScanDateMonthDay(day.date)}：${formatInteger(day.count)}`)
    .join('，')
}

function zoneLabel(zone: string): string {
  return zone.replace(/区$/, '') || zone
}

function pickDefaultZone(groups: RouteZoneGroup[]): string | null {
  if (!groups.length) return null
  return groups.reduce((best, group) => (group.zoneTotal > best.zoneTotal ? group : best)).zone
}

function formatErrorRate(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null
  return `${formatNumber(value * 100, 2)}%`
}

export function RouteCodeZoneBoard({
  routeCodeDistribution,
  dailyRouteCodeCounts,
  totalWaybills,
  zoneInboundScanTotals,
}: Props) {
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const [misallocationMaxCount, setMisallocationMaxCount] = useState<number | null>(null)

  const filteredGroups = useMemo(() => {
    let groups: RouteZoneGroup[]
    if (dailyRouteCodeCounts?.length) {
      groups = buildRouteZoneGroupsFromDaily(dailyRouteCodeCounts, misallocationMaxCount)
    } else {
      const distribution = resolveFilteredRouteCodeDistribution({
        dailyRouteCodeCounts,
        routeCodeDistribution,
        maxCount: misallocationMaxCount,
      })
      groups = buildRouteZoneGroups(distribution)
    }
    return attachZoneInboundScanTotals(groups, zoneInboundScanTotals)
  }, [dailyRouteCodeCounts, routeCodeDistribution, misallocationMaxCount, zoneInboundScanTotals])

  const hiddenRouteCodeCount = useMemo(
    () =>
      countHiddenRouteCodeFilterEntries({
        dailyRouteCodeCounts,
        routeCodeDistribution,
        maxCount: misallocationMaxCount,
      }),
    [dailyRouteCodeCounts, routeCodeDistribution, misallocationMaxCount],
  )

  useEffect(() => {
    setSelectedZone((prev) => {
      if (prev && filteredGroups.some((group) => group.zone === prev)) return prev
      return pickDefaultZone(filteredGroups)
    })
  }, [filteredGroups])

  const grandTotal = useMemo(
    () => filteredGroups.reduce((sum, group) => sum + group.zoneTotal, 0),
    [filteredGroups],
  )

  const hasInboundScanTotals = Boolean(zoneInboundScanTotals?.size)

  const overallErrorRate = useMemo(() => {
    if (!hasInboundScanTotals || !zoneInboundScanTotals) return null
    const inboundTotal = [...zoneInboundScanTotals.values()].reduce((sum, count) => sum + count, 0)
    if (inboundTotal <= 0) return null
    return grandTotal / inboundTotal
  }, [grandTotal, hasInboundScanTotals, zoneInboundScanTotals])

  const selectedGroup = useMemo(
    () => filteredGroups.find((group) => group.zone === selectedZone) ?? null,
    [filteredGroups, selectedZone],
  )

  const selectedTheme = useMemo(
    () => (selectedGroup ? getZoneColorTheme(selectedGroup.zone) : null),
    [selectedGroup],
  )

  if (!routeCodeDistribution.length && !dailyRouteCodeCounts?.length) return null

  return (
    <div className="cancel-scan-zone-board">
      <div className="cancel-scan-zone-board__header">
        <div>
          <h3 className="cancel-scan-zone-board__title">路由码分布</h3>
          <p className="cancel-scan-zone-board__subtitle">
            基于 {formatInteger(totalWaybills)} 条运单 · 首字母划分大区 · 点击方格查看路由码明细
            {hasInboundScanTotals ? (
              <>
                {' '}
                · 占比 = 细分错误票数 / 到件扫描票数（同区间同大区）
              </>
            ) : null}
            {hiddenRouteCodeCount > 0 ? (
              <>
                {' '}
                · 已隐藏 {formatInteger(hiddenRouteCodeCount)} 条
                {dailyRouteCodeCounts?.length ? '「日 × 路由码」' : '路由码'}记录
              </>
            ) : null}
          </p>
        </div>
        <div className="cancel-scan-zone-board__toolbar">
          <label className="cancel-scan-zone-board__filter">
            <span className="cancel-scan-zone-board__filter-label">错误分配过滤</span>
            <InputNumber
              min={0}
              precision={0}
              placeholder="不限"
              value={misallocationMaxCount ?? undefined}
              onChange={(value) => {
                if (value == null) {
                  setMisallocationMaxCount(null)
                  return
                }
                const next = Number(value)
                setMisallocationMaxCount(Number.isFinite(next) && next >= 0 ? next : null)
              }}
              className="cancel-scan-zone-board__filter-input"
            />
          </label>
          <div className="cancel-scan-zone-board__summary">
            合计 <strong>{formatInteger(grandTotal)}</strong> 票 ·{' '}
            <strong>{formatInteger(filteredGroups.length)}</strong> 个大区
            {overallErrorRate != null ? (
              <>
                {' '}
                · 总占比 <strong>{formatErrorRate(overallErrorRate)}</strong>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="cancel-scan-panel__state">
          当前阈值下没有可展示的路由码，请调大「错误分配过滤」数值或清空输入。
        </div>
      ) : (
        <>
          <CancelScanZoneBarChart
            groups={filteredGroups}
            selectedZone={selectedZone}
            onZoneSelect={setSelectedZone}
          />

          <div className="cancel-scan-zone-grid" role="tablist" aria-label="大区选择">
            {filteredGroups.map((group) => {
              const active = group.zone === selectedZone
              const theme = getZoneColorTheme(group.zone)
              const errorRateLabel = formatErrorRate(group.errorRate)
              return (
                <button
                  key={group.zone}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-zone-theme={theme.key}
                  style={zoneThemeStyle(theme)}
                  className={[
                    'cancel-scan-zone-tile',
                    active ? 'cancel-scan-zone-tile--active' : '',
                  ].join(' ')}
                  onClick={() => setSelectedZone(group.zone)}
                >
                  <span className="cancel-scan-zone-tile__letter">{zoneLabel(group.zone)}</span>
                  <span className="cancel-scan-zone-tile__count">{formatInteger(group.zoneTotal)} 票</span>
                  {errorRateLabel ? (
                    <span className="cancel-scan-zone-tile__error-rate">
                      占比 {errorRateLabel}
                      {group.inboundZoneTotal != null
                        ? `（/${formatInteger(group.inboundZoneTotal)}）`
                        : null}
                    </span>
                  ) : (
                    <span className="cancel-scan-zone-tile__share">全区 {formatShare(group.totalShare)}</span>
                  )}
                  <span className="cancel-scan-zone-tile__meta">
                    {errorRateLabel
                      ? `全区 ${formatShare(group.totalShare)} · ${formatInteger(group.routeCodes.length)} 种路由码`
                      : `${formatInteger(group.routeCodes.length)} 种路由码`}
                  </span>
                  <span
                    className="cancel-scan-zone-tile__meter"
                    style={{ transform: `scaleX(${Math.max(group.totalShare, 0.04)})` }}
                    aria-hidden
                  />
                </button>
              )
            })}
          </div>

          <div
            className={[
              'cancel-scan-zone-detail',
              selectedGroup ? 'cancel-scan-zone-detail--visible' : '',
            ].join(' ')}
            style={selectedTheme ? zoneThemeStyle(selectedTheme) : undefined}
            data-zone-theme={selectedTheme?.key}
            role="tabpanel"
            aria-live="polite"
          >
            {selectedGroup ? (
              <>
                <div className="cancel-scan-zone-detail__head">
                  <div className="cancel-scan-zone-detail__head-inner">
                    <span className="cancel-scan-zone-detail__badge">{zoneLabel(selectedGroup.zone)}</span>
                    <div>
                      <span className="cancel-scan-zone-detail__zone">{selectedGroup.zone}</span>
                      <span className="cancel-scan-zone-detail__stats">
                        {formatInteger(selectedGroup.zoneTotal)} 票 · 全区占比{' '}
                        {formatShare(selectedGroup.totalShare)} ·{' '}
                        {formatInteger(selectedGroup.routeCodes.length)} 种路由码
                        {formatErrorRate(selectedGroup.errorRate) ? (
                          <>
                            {' '}
                            · 占比 {formatErrorRate(selectedGroup.errorRate)}
                            {selectedGroup.inboundZoneTotal != null
                              ? `（/${formatInteger(selectedGroup.inboundZoneTotal)} 到件）`
                              : null}
                          </>
                        ) : null}
                      </span>
                    </div>
                  </div>
                </div>

                <ul className="cancel-scan-zone-detail__list">
                  {selectedGroup.routeCodes.map((item, index) => (
                    <li key={item.routeCode} className="cancel-scan-zone-detail__row">
                      <div className="cancel-scan-zone-detail__rank">{index + 1}</div>
                      <div className="cancel-scan-zone-detail__main">
                        <div className="cancel-scan-zone-detail__row-top">
                          <span className="cancel-scan-zone-detail__code">{item.routeCode}</span>
                          {item.dailyCounts && item.dailyCounts.length > 0 ? (
                            <span className="cancel-scan-zone-detail__daily-parens">
                              {formatDailyCountsInline(item.dailyCounts)}
                            </span>
                          ) : (
                            <span className="cancel-scan-zone-detail__count">
                              {formatInteger(item.count)} 票
                            </span>
                          )}
                        </div>
                        <div className="cancel-scan-zone-detail__bar-track">
                          <span
                            className="cancel-scan-zone-detail__bar-fill"
                            style={{ width: `${Math.max(item.zoneShare * 100, 2)}%` }}
                          />
                        </div>
                        <div className="cancel-scan-zone-detail__row-meta">
                          <span>区内 {formatShare(item.zoneShare)}</span>
                          <span>全区 {formatShare(item.totalShare)}</span>
                          {item.dailyCounts && item.dailyCounts.length > 0 ? (
                            <span>合计 {formatInteger(item.count)} 票</span>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="cancel-scan-zone-detail__empty">选择上方大区查看路由码明细</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
