import { Button, DatePicker, Input } from 'antd'
import { Search } from 'lucide-react'
import type { Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('newMerchant')
  const { t: tc } = useTranslation('common')

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_360px_auto] md:items-end">
        <div className="min-w-0">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            {t('clientCodes')}
            <span className="ml-1 text-xs font-normal text-slate-400">{t('clientCodesHint')}</span>
          </label>
          <Input.TextArea
            value={clientCodesText}
            onChange={(e) => onChangeClientCodes(e.target.value)}
            placeholder={t('clientCodesPlaceholder')}
            rows={2}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
        <div className="min-w-0">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            {t('firstCountryRange')}
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
            {tc('search')}
          </Button>
        </div>
      </div>
    </div>
  )
}
