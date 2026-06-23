import { Alert, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { TrendingUp } from 'lucide-react'
import type { FetchedData } from '../useVendorAnalysisPage'
import type { VendorMetricRow } from '../vendorAnalysisTypes'

type Props = {
  metrics: VendorMetricRow[]
  fetchedData: FetchedData
  hasStations: boolean
}

function rateTag(rate: number) {
  const pct = (rate * 100).toFixed(2)
  if (rate >= 0.03) return <Tag color="red">{pct}%</Tag>
  if (rate >= 0.01) return <Tag color="orange">{pct}%</Tag>
  return <Tag color="green">{pct}%</Tag>
}

export function VendorMetricsPreview({ metrics, fetchedData, hasStations }: Props) {
  const fmt = (s: string) => s.slice(0, 10)

  const columns: ColumnsType<VendorMetricRow> = [
    {
      title: '供应商',
      key: 'vendor',
      width: 200,
      render: (_, row) => (
        <div>
          <div className="font-medium text-slate-800">{row.vendorName}</div>
          <div className="text-xs text-slate-400">{row.vendorCode}</div>
        </div>
      ),
    },
    {
      title: () => (
        <div>
          <div>客诉率</div>
          <div className="text-xs font-normal text-slate-400">
            {fmt(fetchedData.ticketStartTime)} ~ {fmt(fetchedData.ticketEndTime)}
          </div>
        </div>
      ),
      dataIndex: 'complaintRate',
      key: 'complaintRate',
      width: 200,
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.complaintRate - b.complaintRate,
      render: (v: number, row) => (
        <div>
          {rateTag(v)}
          <div className="mt-1 text-xs text-slate-400">
            客诉量 {row.complaintCount} 件 · 揽收量 {row.waybillCount} 件
          </div>
        </div>
      ),
    },
    {
      title: '未处理工单',
      dataIndex: 'unprocessedTicketCount',
      key: 'unprocessedTicketCount',
      width: 120,
      sorter: (a, b) => a.unprocessedTicketCount - b.unprocessedTicketCount,
      render: (v: number) => (
        <span className={v > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>{v} 件</span>
      ),
    },
    {
      title: '长尾单',
      dataIndex: 'longTailCount',
      key: 'longTailCount',
      width: 100,
      sorter: (a, b) => a.longTailCount - b.longTailCount,
      render: (v: number) => (
        <span className={v > 0 ? 'text-amber-600 font-medium' : 'text-slate-400'}>{v} 件</span>
      ),
    },
    {
      title: '推送状态',
      key: 'status',
      width: 90,
      render: (_, row) =>
        row.isDisabled ? (
          <span className="text-xs text-slate-400">已禁用</span>
        ) : (
          <span className="text-xs text-emerald-600">将推送</span>
        ),
    },
  ]

  return (
    <div className="admin-panel overflow-hidden">
      <div className="admin-section-title flex flex-wrap items-center gap-3 bg-[var(--admin-surface-soft)]">
        <div>
          <div className="admin-eyebrow">Preview</div>
          <h3 className="admin-title mt-0.5 flex items-center gap-1.5 text-base">
            <TrendingUp className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
            指标预览
          </h3>
        </div>
        <div className="ml-auto text-xs text-slate-500">
          确认数据无误后，点击右上角「供应商数据分析推送」发送至飞书群
        </div>
      </div>

      {!hasStations && (
        <div className="px-5 pt-3">
          <Alert
            type="warning"
            showIcon
            message="未选择责任站点，客诉成立量以全部站点计算，推送时仍以所选站点过滤"
            className="text-xs"
          />
        </div>
      )}

      <div className="px-5 py-4">
        <Table<VendorMetricRow>
          rowKey="vendorCode"
          columns={columns}
          dataSource={metrics}
          pagination={false}
          scroll={{ x: 710 }}
          rowClassName={(row) => (row.isDisabled ? 'opacity-40' : '')}
        />
      </div>
    </div>
  )
}
