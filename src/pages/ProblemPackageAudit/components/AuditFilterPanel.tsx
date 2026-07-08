import { Button, DatePicker, Form, Input } from 'antd'
import { Search } from 'lucide-react'
import dayjs from 'dayjs'
import type { FilterState } from '../types'

type Props = {
  loading: boolean
  total?: number
  onSearch: (filter: FilterState) => void
}

const TODAY = dayjs()

export default function AuditFilterPanel({ loading, total, onSearch }: Props) {
  const [form] = Form.useForm()

  function handleSearch() {
    const values = form.getFieldsValue() as {
      stationCode?: string
      dateRange?: [dayjs.Dayjs, dayjs.Dayjs] | null
    }
    const [start, end] = values.dateRange
      ? [values.dateRange[0].format('YYYY-MM-DD'), values.dateRange[1].format('YYYY-MM-DD')]
      : ['', '']

    onSearch({
      stationCode: values.stationCode?.trim() ?? '',
      dateRange: start && end ? [start, end] : null,
    })
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <Form
        form={form}
        layout="inline"
        className="flex flex-1 flex-wrap items-center gap-y-2"
        initialValues={{ dateRange: [TODAY, TODAY] }}
      >
        <Form.Item label={<span className="text-[12px] text-slate-500">站点代码</span>} name="stationCode" className="mb-0">
          <Input placeholder="如 S210431701" style={{ width: 148 }} />
        </Form.Item>

        <div className="mx-1 h-5 w-px bg-slate-200" />

        <Form.Item label={<span className="text-[12px] text-slate-500">日期范围</span>} name="dateRange" className="mb-0">
          <DatePicker.RangePicker allowClear={false} format="YYYY-MM-DD" style={{ width: 232 }} />
        </Form.Item>
      </Form>

      {total !== undefined && total > 0 && (
        <span className="text-[12px] text-slate-400">共 {total} 条</span>
      )}

      <Button
        type="primary"
        icon={<Search size={13} />}
        loading={loading}
        onClick={handleSearch}
        style={{ backgroundColor: '#2f8f87', borderColor: '#2f8f87' }}
      >
        查询
      </Button>
    </div>
  )
}
