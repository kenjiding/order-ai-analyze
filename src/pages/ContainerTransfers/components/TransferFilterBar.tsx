import { useEffect, useState } from 'react'
import { Button, DatePicker, Input, Select } from 'antd'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import {
  TRANSFER_STATUSES,
  transferStatusLabel,
} from '../../../containerManagement/constants'
import type { ContainerAccount, TransferStatus } from '../../../containerManagement/types'
import type { TransferFilters } from '../useContainerTransfersPage'

const RANGE_PRESETS: { label: string; value: [Dayjs, Dayjs] }[] = [
  { label: '今天', value: [dayjs().startOf('day'), dayjs().endOf('day')] },
  { label: '近 7 天', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] },
  { label: '近 30 天', value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] },
]

type Props = {
  accounts: ContainerAccount[]
  filters: TransferFilters
  loading: boolean
  onApply: (filters: TransferFilters) => void
}

export function TransferFilterBar({ accounts, filters, loading, onApply }: Props) {
  const [draft, setDraft] = useState<TransferFilters>(filters)

  // 从容器台账「关联流转」跳转进来时，URL 带的 ID 要回填到输入框
  useEffect(() => {
    setDraft(filters)
  }, [filters])

  const accountOptions = accounts.map((account) => ({ value: account.id, label: account.name }))

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">记录编号</span>
        <Input
          className="w-44 font-mono"
          placeholder="如 123 或 TR-000123"
          allowClear
          autoComplete="off"
          spellCheck={false}
          value={draft.transferId}
          onChange={(e) => setDraft((prev) => ({ ...prev, transferId: e.target.value }))}
          onPressEnter={() => onApply(draft)}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">转出方</span>
        <Select
          className="w-44"
          placeholder="全部"
          allowClear
          showSearch
          optionFilterProp="label"
          value={draft.fromAccountId || undefined}
          onChange={(value) => setDraft((prev) => ({ ...prev, fromAccountId: value ?? '' }))}
          options={accountOptions}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">接收方</span>
        <Select
          className="w-44"
          placeholder="全部"
          allowClear
          showSearch
          optionFilterProp="label"
          value={draft.toAccountId || undefined}
          onChange={(value) => setDraft((prev) => ({ ...prev, toAccountId: value ?? '' }))}
          options={accountOptions}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">状态</span>
        <Select
          className="w-36"
          placeholder="全部"
          allowClear
          value={draft.status || undefined}
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, status: (value ?? '') as TransferStatus | '' }))
          }
          options={TRANSFER_STATUSES.map((status) => ({
            value: status,
            label: transferStatusLabel[status],
          }))}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">日期区间</span>
        <DatePicker.RangePicker
          value={draft.range}
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, range: (value as [Dayjs, Dayjs] | null) ?? null }))
          }
          presets={RANGE_PRESETS}
          allowClear
          inputReadOnly
        />
      </label>
      <Button type="primary" loading={loading} onClick={() => onApply(draft)}>
        搜索
      </Button>
    </div>
  )
}
