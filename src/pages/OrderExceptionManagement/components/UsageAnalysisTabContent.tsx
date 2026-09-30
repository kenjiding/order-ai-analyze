import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { OrderExceptionUsageStatRow } from '../orderExceptionApi'

type Props = {
  rows: OrderExceptionUsageStatRow[]
  isLoading: boolean
  onRefresh: () => void
}

export function UsageAnalysisTabContent({ rows, isLoading, onRefresh }: Props) {
  const { t } = useTranslation('orderException')
  const { t: tc } = useTranslation('common')

  const columns: ColumnsType<OrderExceptionUsageStatRow> = useMemo(
    () => [
      {
        title: t('usageAnalysis.colUser'),
        key: 'user',
        render: (_, row) => row.displayName || row.username,
      },
      {
        title: t('usageAnalysis.colAnalyzedOrderCount'),
        dataIndex: 'analyzedOrderCount',
        key: 'analyzedOrderCount',
        sorter: (a, b) => a.analyzedOrderCount - b.analyzedOrderCount,
        defaultSortOrder: 'descend',
      },
      {
        title: t('usageAnalysis.colOrderClickCount'),
        dataIndex: 'orderClickCount',
        key: 'orderClickCount',
        sorter: (a, b) => a.orderClickCount - b.orderClickCount,
      },
      {
        title: t('usageAnalysis.colExportCount'),
        dataIndex: 'exportCount',
        key: 'exportCount',
        sorter: (a, b) => a.exportCount - b.exportCount,
      },
      {
        title: t('usageAnalysis.colClosureAddCount'),
        dataIndex: 'closureAddCount',
        key: 'closureAddCount',
        sorter: (a, b) => a.closureAddCount - b.closureAddCount,
      },
      {
        title: t('usageAnalysis.colUpdatedAt'),
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        render: (updatedAt: string) => <span className="text-slate-500">{new Date(updatedAt).toLocaleString()}</span>,
      },
    ],
    [t],
  )

  return (
    <div className="space-y-4">
      <div className="admin-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">{t('tabUsageAnalysis')}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{t('usageAnalysis.description')}</p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="admin-btn border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            {tc('refresh')}
          </button>
        </div>
      </div>

      <div className="admin-panel overflow-hidden">
        <Table<OrderExceptionUsageStatRow>
          rowKey="userId"
          loading={isLoading}
          columns={columns}
          dataSource={rows}
          locale={{ emptyText: t('usageAnalysis.empty') }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      </div>
    </div>
  )
}
