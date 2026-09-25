import { useMemo } from 'react'
import { Empty, InputNumber, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import { colorFromMap } from '../vendorColors'
import { formatMetricValue } from '../vendorRegionMapTypes'
import type { useVendorRegionMapPage } from '../useVendorRegionMapPage'
import type { RouteMergeGroup, RouteMergeMember, RouteMergeParams } from '../routeMergeSuggestion'

const nf = new Intl.NumberFormat('en-AU')

function MemberBreakdownTable({ members }: { members: RouteMergeMember[] }) {
  const { t } = useTranslation('vendorRegionMap')
  const columns: ColumnsType<RouteMergeMember> = [
    { title: t('merge.memberColRoute'), dataIndex: 'routeCode', width: 140 },
    {
      title: t('merge.memberColAvgVolume'),
      dataIndex: 'avgVolume',
      width: 110,
      sorter: (a, b) => a.avgVolume - b.avgVolume,
      render: (v: number) => nf.format(Math.round(v)),
    },
    {
      title: t('merge.memberColVolume'),
      dataIndex: 'totalCount',
      width: 100,
      sorter: (a, b) => a.totalCount - b.totalCount,
      render: (v: number) => nf.format(v),
    },
    {
      title: t('merge.memberColCourierProfit'),
      dataIndex: 'totalCourierProfit',
      width: 130,
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.totalCourierProfit - b.totalCourierProfit,
      render: (v: number) => formatMetricValue(v, 'courierProfit'),
    },
  ]
  return (
    <Table<RouteMergeMember>
      rowKey={(row) => `${row.supplierKey}\0${row.routeCode}`}
      columns={columns}
      dataSource={members}
      pagination={false}
    />
  )
}

type Props = {
  page: ReturnType<typeof useVendorRegionMapPage>
  mergeGroups: RouteMergeGroup[]
  params: RouteMergeParams
  onParamsChange: (patch: Partial<RouteMergeParams>) => void
}

export function VendorRouteMergeTab({ page, mergeGroups, params, onParamsChange }: Props) {
  const { t } = useTranslation('vendorRegionMap')

  const supplierNameByKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const vendor of page.data?.vendors ?? []) map.set(vendor.supplierKey, vendor.supplierName)
    return map
  }, [page.data])

  const columns: ColumnsType<RouteMergeGroup> = useMemo(
    () => [
      {
        title: t('merge.colSupplier'),
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
        title: t('merge.colMembers'),
        dataIndex: 'members',
        width: 100,
        sorter: (a, b) => a.members.length - b.members.length,
        render: (members: RouteMergeGroup['members']) => members.length,
      },
      { title: t('merge.colRepresentative'), dataIndex: 'representativeRouteCode', width: 140 },
      {
        title: t('merge.colTotalVolume'),
        dataIndex: 'totalCount',
        width: 110,
        sorter: (a, b) => a.totalCount - b.totalCount,
        render: (v: number) => nf.format(v),
      },
      {
        title: t('merge.colTotalCourierProfit'),
        dataIndex: 'totalCourierProfit',
        width: 160,
        defaultSortOrder: 'descend',
        sorter: (a, b) => a.totalCourierProfit - b.totalCourierProfit,
        render: (v: number) => formatMetricValue(v, 'courierProfit'),
      },
    ],
    [page.vendorColorMap, supplierNameByKey, t],
  )

  return (
    <div className="space-y-5">
      <section className="admin-panel px-5 py-4 space-y-3">
        <p className="text-sm text-slate-500">{t('merge.hint')}</p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="vrm-field">
            <span className="vrm-field__label">{t('merge.volumeThresholdLabel')}</span>
            <InputNumber
              min={1}
              value={params.volumeThreshold}
              onChange={(value) =>
                onParamsChange({ volumeThreshold: typeof value === 'number' ? value : params.volumeThreshold })
              }
            />
          </label>
          <label className="vrm-field">
            <span className="vrm-field__label">{t('merge.clusterDistanceLabel')}</span>
            <InputNumber
              min={0.1}
              step={0.5}
              value={params.clusterDistanceKm}
              onChange={(value) =>
                onParamsChange({ clusterDistanceKm: typeof value === 'number' ? value : params.clusterDistanceKm })
              }
            />
          </label>
          <label className="vrm-field">
            <span className="vrm-field__label">{t('merge.maxGroupVolumeLabel')}</span>
            <InputNumber
              min={1}
              value={params.maxGroupVolume}
              onChange={(value) =>
                onParamsChange({ maxGroupVolume: typeof value === 'number' ? value : params.maxGroupVolume })
              }
            />
          </label>
        </div>
      </section>
      <section className="admin-panel overflow-hidden">
        <Table<RouteMergeGroup>
          rowKey={(row) => row.members.map((member) => `${member.supplierKey}\0${member.routeCode}`).join(',')}
          columns={columns}
          dataSource={mergeGroups}
          loading={page.loading}
          locale={{ emptyText: <Empty description={t('merge.empty')} /> }}
          expandable={{
            rowExpandable: (row) => row.members.length > 0,
            expandedRowRender: (row) => <MemberBreakdownTable members={row.members} />,
          }}
          pagination={{ pageSize: 50, showTotal: (total) => t('merge.rowsTotal', { total }) }}
          scroll={{ x: 900 }}
        />
      </section>
    </div>
  )
}
