import { DatePicker, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AU_REGIONS } from '../../ExitAlarm/exitAlarmTypes'
import { PUSH_LABELS } from '../pushEngagementTypes'

type Props = {
  dateRange: [Dayjs, Dayjs]
  onChangeDateRange: (range: [Dayjs, Dayjs]) => void
  pushLabels: string[]
  onChangePushLabels: (labels: string[]) => void
  supplierConfigId: string | null
  onChangeSupplierConfigId: (id: string | null) => void
  supplierOptions: { label: string; value: string }[]
  suppliersLoading: boolean
  regionCode: string | null
  onChangeRegionCode: (code: string | null) => void
}

export function PushEngagementFilterBar(props: Props) {
  const { t } = useTranslation('pushEngagement')

  const presets = useMemo(
    () => [
      { label: t('presetToday'), value: [dayjs().startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
      { label: t('preset7d'), value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
      { label: t('preset30d'), value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
    ],
    [t],
  )

  const pushLabelOptions = useMemo(
    () =>
      PUSH_LABELS.map((label) => ({
        label: t(`pushLabels.${label}`, { defaultValue: label }),
        value: label,
      })),
    [t],
  )

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-80">
        <DatePicker.RangePicker
          value={props.dateRange}
          onChange={(values) => {
            if (values && values[0] && values[1]) {
              props.onChangeDateRange([values[0], values[1]])
            }
          }}
          format="YYYY-MM-DD"
          inputReadOnly
          allowClear={false}
          presets={presets}
          className="w-full"
        />
      </div>
      <div className="w-64">
        <Select
          mode="multiple"
          value={props.pushLabels}
          onChange={props.onChangePushLabels}
          placeholder={t('allPushTypes')}
          allowClear
          className="w-full"
          maxTagCount="responsive"
          options={pushLabelOptions}
        />
      </div>
      <div className="w-64">
        <Select
          value={props.supplierConfigId ?? undefined}
          onChange={(v) => props.onChangeSupplierConfigId(v ?? null)}
          placeholder={t('allSuppliers')}
          allowClear
          showSearch
          loading={props.suppliersLoading}
          className="w-full"
          optionFilterProp="label"
          options={props.supplierOptions}
        />
      </div>
      <div className="w-44">
        <Select
          value={props.regionCode ?? undefined}
          onChange={(v) => props.onChangeRegionCode(v ?? null)}
          placeholder={t('allRegions')}
          allowClear
          className="w-full"
          options={AU_REGIONS.map((r) => ({ label: r.name, value: r.code }))}
        />
      </div>
    </div>
  )
}
