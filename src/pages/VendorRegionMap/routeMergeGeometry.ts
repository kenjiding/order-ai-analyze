import type { Feature, FeatureCollection } from 'geojson'
import type { RouteLabelArea } from './columnGeometry'
import type { RouteMergeGroup } from './routeMergeSuggestion'

function mergedMemberKeys(groups: RouteMergeGroup[]): Set<string> {
  const keys = new Set<string>()
  for (const group of groups) {
    for (const member of group.members) keys.add(`${member.supplierKey}\0${member.routeCode}`)
  }
  return keys
}

/**
 * 智能合并态下，已经进了某个簇的路由码要从原始摆位列表里摘掉，剩下的沿用现成的
 * buildRouteCodeLabelCollection 环形摆位逻辑渲染成单路由标签——不重新实现摆位算法。
 */
export function excludeMergedRoutes(areas: RouteLabelArea[], groups: RouteMergeGroup[]): RouteLabelArea[] {
  const merged = mergedMemberKeys(groups)
  if (merged.size === 0) return areas
  return areas.map((area) => ({
    ...area,
    routes: area.routes.filter((route) => !merged.has(`${route.supplierKey}\0${route.routeCode}`)),
  }))
}

/**
 * 合并簇渲染成一个「N条路由已合并」标签，直接落在簇的加权代表坐标——簇本来就跨郊区，
 * 不套用郊区摆位逻辑（那是给同一郊区内多个路由码错位摆放用的，语义不同）。
 * 簇只会在同一供应商内部产生，标签颜色就用这家供应商的色，跟单路由标签一致。
 */
export function buildRouteMergeClusterCollection(
  groups: RouteMergeGroup[],
  colorOf: (supplierKey: string) => string,
): FeatureCollection {
  const features: Feature[] = groups.map((group) => ({
    type: 'Feature',
    properties: {
      isCluster: true,
      routeCode: group.representativeRouteCode,
      memberCount: group.members.length,
      count: group.totalCount,
      courierProfit: group.totalCourierProfit,
      sortKey: -group.totalCount,
      color: colorOf(group.supplierKey),
      clusterKey: group.members.map((member) => `${member.supplierKey}\0${member.routeCode}`).join(','),
    },
    geometry: { type: 'Point', coordinates: group.center },
  }))
  return { type: 'FeatureCollection', features }
}
