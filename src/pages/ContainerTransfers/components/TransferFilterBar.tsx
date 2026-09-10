import { useEffect, useMemo, useState } from 'react'
import { Button, DatePicker, Input, Select } from 'antd'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import { TRANSFER_STATUSES } from '../../../containerManagement/constants'
import type { ContainerAccount, TransferStatus } from '../../../containerManagement/types'
import type { TransferFilters } from '../useContainerTransfersPage'

type Props = {
  accounts: ContainerAccount[]
  filters: TransferFilters
  loading: boolean
  onApply: (filters: TransferFilters) => void
}

export function TransferFilterBar({ accounts, filters, loading, onApply }: Props) {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const [draft, setDraft] = useState<TransferFilters>(filters)

  const rangePresets = useMemo(
    () => [
      { label: t('datePresetToday'), value: [dayjs().startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
      {
        label: t('datePreset7d'),
        value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
      },
      {
        label: t('datePreset30d'),
        value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
      },
    ],
    [t],
  )

  useEffect(() => {
    setDraft(filters)
  }, [filters])

  const accountOptions = accounts.map((account) => ({ value: account.id, label: account.name }))

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">{t('transfers.filterTransferId')}</span>
        <Input
          className="w-44 font-mono"
          placeholder={t('transfers.filterTransferIdPlaceholder')}
          allowClear
          autoComplete="off"
          spellCheck={false}
          value={draft.transferId}
          onChange={(e) => setDraft((prev) => ({ ...prev, transferId: e.target.value }))}
          onPressEnter={() => onApply(draft)}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">{t('transfers.filterFrom')}</span>
        <Select
          className="w-44"
          placeholder={tc('all')}
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          optionFilterProp="label"
          value={draft.fromAccountIds}
          onChange={(value) => setDraft((prev) => ({ ...prev, fromAccountIds: value }))}
          options={accountOptions}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">{t('transfers.filterTo')}</span>
        <Select
          className="w-44"
          placeholder={tc('all')}
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          optionFilterProp="label"
          value={draft.toAccountIds}
          onChange={(value) => setDraft((prev) => ({ ...prev, toAccountIds: value }))}
          options={accountOptions}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">{tc('status')}</span>
        <Select
          className="w-36"
          placeholder={tc('all')}
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          value={draft.statuses}
          onChange={(value) => setDraft((prev) => ({ ...prev, statuses: value as TransferStatus[] }))}
          options={TRANSFER_STATUSES.map((status) => ({
            value: status,
            label: t(`transferStatus.${status}`),
          }))}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-500">{t('transfers.filterDateRange')}</span>
        <DatePicker.RangePicker
          value={draft.range}
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, range: (value as [Dayjs, Dayjs] | null) ?? null }))
          }
          presets={rangePresets}
          allowClear
          inputReadOnly
        />
      </label>
      <Button type="primary" loading={loading} onClick={() => onApply(draft)}>
        {tc('search')}
      </Button>
    </div>
  )
}
