import { Button, DatePicker, Tag } from 'antd'
import type { Dayjs } from 'dayjs'
import { CalendarDays, CheckCircle2, DatabaseZap } from 'lucide-react'
import type { FetchedData } from '../useVendorAnalysisPage'

type Props = {
  referenceDate: Dayjs | null
  onReferenceDateChange: (date: Dayjs | null) => void
  complaintDateRange: [Dayjs, Dayjs] | null
  onComplaintDateRangeChange: (range: [Dayjs, Dayjs] | null) => void
  fetchedData: FetchedData | null
  dataFetching: boolean
  onFetchData: () => void
}

export function VendorFilterPanel({
  referenceDate,
  onReferenceDateChange,
  complaintDateRange,
  onComplaintDateRangeChange,
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
              数据参考日期
            </label>
            <DatePicker
              value={referenceDate}
              onChange={(v) => onReferenceDateChange(v)}
              format="YYYY-MM-DD"
              allowClear
              className="w-40"
              placeholder="选择参考日期"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <CalendarDays className="h-3.5 w-3.5 text-amber-500" />
              客诉成立量时间
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
              disabled={!referenceDate || !complaintDateRange}
              onClick={onFetchData}
            >
              {dataFetching ? '获取中…' : '获取数据'}
            </Button>
          </div>
        </div>

        {fetchedData && referenceDate && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-xs text-slate-500">{fetchedTime} 获取成功：</span>
            <Tag color="purple" className="text-xs">
              参考日期 {referenceDate.format('YYYY-MM-DD')}
              <span className="ml-1 text-slate-400">
                （昨天 {fetchedData.before11Date}）
              </span>
            </Tag>
            <Tag color="blue" className="text-xs">
              运单 {fetchedData.waybills.length} 条
              <span className="ml-1 text-slate-400">
                ({fetchedData.startTime.slice(0, 10)} ~ {fetchedData.endTime.slice(0, 10)})
              </span>
            </Tag>
            <Tag color="orange" className="text-xs">
              客诉 {fetchedData.tickets.length} 条
            </Tag>
          </div>
        )}
      </div>
    </div>
  )
}
