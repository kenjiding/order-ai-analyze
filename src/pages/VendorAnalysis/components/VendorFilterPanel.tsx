import { Button, DatePicker, Tag, Tooltip, Typography } from 'antd'
import type { Dayjs } from 'dayjs'
import { CalendarDays, CheckCircle2, DatabaseZap } from 'lucide-react'
import type { FineBiConnectionConfig } from '../fineBiConnectionStorage'
import type { FetchedData } from '../useVendorAnalysisPage'
import { FineBiConnectionPanel } from './FineBiConnectionPanel'

type Props = {
  dateRange: [Dayjs, Dayjs] | null
  onDateRangeChange: (range: [Dayjs, Dayjs] | null) => void
  complaintDateRange: [Dayjs, Dayjs] | null
  onComplaintDateRangeChange: (range: [Dayjs, Dayjs] | null) => void
  fineBiConnections: FineBiConnectionConfig[]
  onFineBiConnectionsChange: (next: FineBiConnectionConfig[]) => void
  fetchedData: FetchedData | null
  dataFetching: boolean
  onFetchData: () => void
}

export function VendorFilterPanel({
  dateRange,
  onDateRangeChange,
  complaintDateRange,
  onComplaintDateRangeChange,
  fineBiConnections,
  onFineBiConnectionsChange,
  fetchedData,
  dataFetching,
  onFetchData,
}: Props) {
  const fetchedTime = fetchedData
    ? `${fetchedData.fetchedAt.getHours().toString().padStart(2, '0')}:${fetchedData.fetchedAt.getMinutes().toString().padStart(2, '0')}`
    : null

  return (
    <div className="admin-panel">
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-[var(--admin-accent)]">
            筛选条件
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <CalendarDays className="h-3.5 w-3.5" />
              时间范围
            </label>
            <DatePicker.RangePicker
              value={dateRange}
              onChange={(v) => onDateRangeChange(v as [Dayjs, Dayjs] | null)}
              format="YYYY-MM-DD"
              allowClear
              className="w-64"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <CalendarDays className="h-3.5 w-3.5 text-amber-500" />
              <Tooltip title="不填则使用上方「时间范围」">
                <span className="cursor-help border-b border-dashed border-slate-400">
                  客诉成立量时间
                  <Typography.Text type="secondary" className="!text-xs ml-1">(可选)</Typography.Text>
                </span>
              </Tooltip>
            </label>
            <DatePicker.RangePicker
              value={complaintDateRange}
              onChange={(v) => onComplaintDateRangeChange(v as [Dayjs, Dayjs] | null)}
              format="YYYY-MM-DD"
              allowClear
              className="w-64"
              placeholder={['客诉开始日期', '客诉结束日期']}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1 text-xs font-medium text-transparent select-none">
              &nbsp;
            </label>
            <Button
              type="primary"
              icon={<DatabaseZap className="h-4 w-4" />}
              loading={dataFetching}
              disabled={!dateRange}
              onClick={onFetchData}
            >
              {dataFetching ? '获取中…' : '获取数据'}
            </Button>
          </div>
        </div>

        <div className="mt-4 border-t border-[var(--admin-line)] pt-4">
          <FineBiConnectionPanel
            connections={fineBiConnections}
            onChange={onFineBiConnectionsChange}
          />
        </div>

        {fetchedData && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-xs text-slate-500">{fetchedTime} 获取成功：</span>
            <Tag color="blue" className="text-xs">
              运单 {fetchedData.waybills.length} 条
              <span className="ml-1 text-slate-400">
                ({fetchedData.startTime.slice(0, 10)} ~ {fetchedData.endTime.slice(0, 10)})
              </span>
            </Tag>
            <Tag color="orange" className="text-xs">
              客诉 {fetchedData.tickets.length} 条
              <span className="ml-1 text-slate-400">
                ({fetchedData.ticketStartTime.slice(0, 10)} ~ {fetchedData.ticketEndTime.slice(0, 10)})
              </span>
            </Tag>
          </div>
        )}
      </div>
    </div>
  )
}
