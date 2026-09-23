import { useMemo } from 'react'
import { Alert, Empty, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { aggregateZipStats } from '../columnGeometry'
import { formatDensity } from '../regionMetrics'
import { colorFromMap } from '../vendorColors'
import type { useVendorRegionMapPage } from '../useVendorRegionMapPage'
import { useWarehouseConfigData } from '../useWarehouseConfigData'
import {
  computeRouteDifficulty,
  computeSupplierDifficulty,
  type DifficultyLevel,
  type RouteDifficultyRow,
  type RouteDifficultyZipDetail,
  type SupplierDifficultyRow,
  type WarehouseConfig,
  type WarehouseSource,
} from '../routeDifficulty'
import { formatDistanceKm } from '../warehouseOverlay'

const nf = new Intl.NumberFormat('en-AU')

const LEVEL_COLOR: Record<DifficultyLevel | 'unknown', string> = {
  easy: 'green',
  fair: 'lime',
  medium: 'gold',
  hard: 'orange',
  extreme: 'red',
  unknown: 'default',
}

function DifficultyTag({ level }: { level: DifficultyLevel | 'unknown' }) {
  const { t } = useTranslation('vendorRegionMap')
  return <Tag color={LEVEL_COLOR[level]}>{t(`difficulty.level.${level}`)}</Tag>
}

/** 站点坐标是正常情况，不额外提示；退化到大区主仓时才需要提醒运营去补这个站点的地址 */
function WarehouseSourceHint({ source }: { source: WarehouseSource }) {
  const { t } = useTranslation('vendorRegionMap')
  if (source !== 'region') return null
  return (
    <Tooltip title={t('difficulty.warehouseSourceRegionHint')}>
      <TriangleAlert className="ml-1 inline h-3.5 w-3.5 text-amber-500" aria-hidden />
    </Tooltip>
  )
}

function ZipBreakdownTable({ zips }: { zips: RouteDifficultyZipDetail[] }) {
  const { t } = useTranslation('vendorRegionMap')
  const columns: ColumnsType<RouteDifficultyZipDetail> = [
    {
      title: t('difficulty.colZip'),
      dataIndex: 'zipCode',
      width: 120,
      render: (value: string, row) => `${value}${row.suburb ? ` · ${row.suburb}` : ''}`,
    },
    { title: t('difficulty.colVolume'), dataIndex: 'count', width: 100, render: (v: number) => nf.format(v) },
    {
      title: t('difficulty.colDistance'),
      dataIndex: 'distanceKm',
      width: 100,
      render: (v: number | null) => (v == null ? '—' : formatDistanceKm(v)),
    },
    {
      title: t('difficulty.colDensity'),
      dataIndex: 'density',
      width: 130,
      render: (v: number | null) => (v == null ? '—' : `${formatDensity(v)} ${t('difficulty.perKm2')}`),
    },
  ]
  return <Table<RouteDifficultyZipDetail> rowKey="zipCode" columns={columns} dataSource={zips} pagination={false} />
}

function RouteBreakdownTable({ routes }: { routes: RouteDifficultyRow[] }) {
  const { t } = useTranslation('vendorRegionMap')
  const columns: ColumnsType<RouteDifficultyRow> = [
    { title: t('difficulty.colRouteCode'), dataIndex: 'routeCode', width: 140 },
    {
      title: t('difficulty.colZipCount'),
      dataIndex: 'zips',
      width: 90,
      sorter: (a, b) => a.zips.length - b.zips.length,
      render: (zips: RouteDifficultyZipDetail[]) => zips.length,
    },
    {
      title: t('difficulty.colVolume'),
      dataIndex: 'totalCount',
      width: 100,
      sorter: (a, b) => a.totalCount - b.totalCount,
      render: (v: number) => nf.format(v),
    },
    {
      title: t('difficulty.colDistance'),
      dataIndex: 'distanceKm',
      width: 120,
      sorter: (a, b) => (a.distanceKm ?? -1) - (b.distanceKm ?? -1),
      render: (v: number | null, row) => (
        <>
          {v == null ? '—' : formatDistanceKm(v)}
          <WarehouseSourceHint source={row.warehouseSource} />
        </>
      ),
    },
    {
      title: t('difficulty.colDensity'),
      dataIndex: 'density',
      width: 130,
      sorter: (a, b) => (a.density ?? -1) - (b.density ?? -1),
      render: (v: number | null) => (v == null ? '—' : `${formatDensity(v)} ${t('difficulty.perKm2')}`),
    },
    {
      title: t('difficulty.colScore'),
      dataIndex: 'difficulty',
      width: 90,
      defaultSortOrder: 'descend',
      sorter: (a, b) => (a.difficulty ?? -1) - (b.difficulty ?? -1),
      render: (v: number | null) => (v == null ? '—' : v.toFixed(2)),
    },
    {
      title: t('difficulty.colLevel'),
      dataIndex: 'level',
      width: 100,
      render: (level: DifficultyLevel | 'unknown') => <DifficultyTag level={level} />,
    },
  ]
  return (
    <Table<RouteDifficultyRow>
      rowKey={(row) => row.routeCode}
      columns={columns}
      dataSource={routes}
      pagination={false}
      expandable={{
        rowExpandable: (row) => row.zips.length > 1,
        expandedRowRender: (row) => <ZipBreakdownTable zips={row.zips} />,
      }}
    />
  )
}

type Props = {
  page: ReturnType<typeof useVendorRegionMapPage>
}

export function VendorRouteDifficultyTab({ page }: Props) {
  const { t } = useTranslation('vendorRegionMap')
  const { regionWarehouse, stations, loaded: warehouseConfigLoaded } = useWarehouseConfigData()

  const warehouseConfig = useMemo<WarehouseConfig>(
    () => ({
      stationCoordsByName: new Map(stations.map((s) => [s.stationName, { lat: s.lat, lng: s.lng }])),
      regionWarehouse: regionWarehouse ? { lat: regionWarehouse.lat, lng: regionWarehouse.lng } : null,
    }),
    [stations, regionWarehouse],
  )

  const supplierRows = useMemo(() => {
    if (!page.data || !warehouseConfigLoaded) return []
    // 独立于「区域地图」Tab 的供应商筛选，这里始终展示当次查询的全量路由数据
    const zipStats = aggregateZipStats({ cells: page.data.cells, zipRegions: page.data.zipRegions, metric: 'count' })
    const routeRows = computeRouteDifficulty(page.data.routes, zipStats, warehouseConfig)
    return computeSupplierDifficulty(routeRows)
  }, [page.data, warehouseConfig, warehouseConfigLoaded])

  const supplierNameByKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const vendor of page.data?.vendors ?? []) map.set(vendor.supplierKey, vendor.supplierName)
    return map
  }, [page.data])

  const columns: ColumnsType<SupplierDifficultyRow> = useMemo(
    () => [
      {
        title: t('difficulty.colSupplier'),
        dataIndex: 'supplierKey',
        width: 180,
        render: (supplierKey: string) => (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: colorFromMap(page.vendorColorMap, supplierKey) }}
              aria-hidden
            />
            {supplierNameByKey.get(supplierKey) ?? supplierKey}
          </span>
        ),
      },
      {
        title: t('difficulty.colRouteCount'),
        dataIndex: 'routeCount',
        width: 90,
        sorter: (a, b) => a.routeCount - b.routeCount,
      },
      {
        title: t('difficulty.colVolume'),
        dataIndex: 'totalCount',
        width: 110,
        sorter: (a, b) => a.totalCount - b.totalCount,
        render: (value: number) => nf.format(value),
      },
      {
        title: t('difficulty.colDistance'),
        dataIndex: 'distanceKm',
        width: 110,
        sorter: (a, b) => (a.distanceKm ?? -1) - (b.distanceKm ?? -1),
        render: (value: number | null) => (value == null ? '—' : formatDistanceKm(value)),
      },
      {
        title: t('difficulty.colDensity'),
        dataIndex: 'density',
        width: 130,
        sorter: (a, b) => (a.density ?? -1) - (b.density ?? -1),
        render: (value: number | null) => (value == null ? '—' : `${formatDensity(value)} ${t('difficulty.perKm2')}`),
      },
      {
        title: t('difficulty.colScore'),
        dataIndex: 'difficulty',
        width: 100,
        defaultSortOrder: 'descend',
        sorter: (a, b) => (a.difficulty ?? -1) - (b.difficulty ?? -1),
        render: (value: number | null) => (value == null ? '—' : value.toFixed(2)),
      },
      {
        title: t('difficulty.colLevel'),
        dataIndex: 'level',
        width: 100,
        render: (level: DifficultyLevel | 'unknown') => <DifficultyTag level={level} />,
      },
      {
        title: t('difficulty.colHardRoutes'),
        dataIndex: 'hardRouteCount',
        width: 100,
        sorter: (a, b) => a.hardRouteCount - b.hardRouteCount,
      },
    ],
    [page.vendorColorMap, supplierNameByKey, t],
  )

  return (
    <div className="space-y-5">
      <section className="admin-panel px-5 py-4">
        <p className="text-sm text-slate-500">{t('difficulty.hint')}</p>
      </section>
      {warehouseConfigLoaded && !regionWarehouse ? (
        <Alert type="warning" showIcon message={t('difficulty.noRegionWarehouse')} />
      ) : null}
      <section className="admin-panel overflow-hidden">
        <Table<SupplierDifficultyRow>
          rowKey={(row) => row.supplierKey}
          columns={columns}
          dataSource={supplierRows}
          loading={page.loading || !warehouseConfigLoaded}
          locale={{ emptyText: <Empty description={t('difficulty.empty')} /> }}
          expandable={{
            rowExpandable: (row) => row.routes.length > 0,
            expandedRowRender: (row) => <RouteBreakdownTable routes={row.routes} />,
          }}
          pagination={{ pageSize: 50, showTotal: (total) => t('difficulty.rowsTotal', { total }) }}
          scroll={{ x: 1100 }}
        />
      </section>
    </div>
  )
}
