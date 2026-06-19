import { Button, DatePicker, Input } from 'antd'
import { Search } from 'lucide-react'
import type { Dayjs } from 'dayjs'

type Props = {
  clientCodesText: string
  onChangeClientCodes: (v: string) => void
  dateRange: [Dayjs, Dayjs] | null
  onChangeDateRange: (v: [Dayjs, Dayjs] | null) => void
  loading: boolean
  canSubmit: boolean
  onSubmit: () => void
}

export default function NewMerchantFilterPanel({
  clientCodesText,
  onChangeClientCodes,
  dateRange,
  onChangeDateRange,
  loading,
  canSubmit,
  onSubmit,
}: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_360px_auto] md:items-end">
        <div className="min-w-0">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            新商家代码
            <span className="ml-1 text-xs font-normal text-slate-400">
              支持逗号 / 空格 / 换行分隔
            </span>
          </label>
          <Input.TextArea
            value={clientCodesText}
            onChange={(e) => onChangeClientCodes(e.target.value)}
            placeholder="示例：C2104188501, C2104188502"
            rows={2}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
        <div className="min-w-0">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            首次到国时间范围
          </label>
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(values) => onChangeDateRange(values as [Dayjs, Dayjs] | null)}
            format="YYYY-MM-DD"
            allowClear
            className="w-full"
          />
        </div>
        <div className="md:pb-[1px]">
          <Button
            type="primary"
            block
            loading={loading}
            disabled={!canSubmit}
            icon={<Search className="h-4 w-4" aria-hidden />}
            onClick={onSubmit}
          >
            查询
          </Button>
        </div>
      </div>
    </div>
  )
}
