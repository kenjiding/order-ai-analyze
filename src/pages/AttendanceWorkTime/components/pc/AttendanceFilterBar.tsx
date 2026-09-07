import { DatePicker, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AU_REGIONS } from '../../attendanceWorkTimeTypes'

type Props = {
  regionCode: string | null
  dateRange: [Dayjs, Dayjs] | null
  isSuperAdmin: boolean
  ownRegionCode: string | null
  onChangeRegion: (regionCode: string | null) => void
  onChangeDateRange: (dateRange: [Dayjs, Dayjs] | null) => void
}

function RegionControl({
  regionCode,
  isSuperAdmin,
  ownRegionCode,
  onChangeRegion,
  allRegionsLabel,
}: Omit<Props, 'dateRange' | 'onChangeDateRange'> & { allRegionsLabel: string }) {
  if (!isSuperAdmin) {
    const label = AU_REGIONS.find((r) => r.code === ownRegionCode)?.name ?? ownRegionCode ?? '—'
    return <Select value={ownRegionCode ?? undefined} disabled className="w-full" options={[{ label, value: ownRegionCode ?? '' }]} />
  }
  return (
    <Select
      value={regionCode ?? undefined}
      onChange={(v) => onChangeRegion(v ?? null)}
      allowClear
      placeholder={allRegionsLabel}
      className="w-full"
      options={AU_REGIONS.map((r) => ({ label: r.name, value: r.code }))}
    />
  )
}

// 仅供桌面端使用；移动端是现场记录页面，不展示筛选入口（见 AttendanceWorkTimePage 的 isMobile 分支）
export function AttendanceFilterBar(props: Props) {
  const { t } = useTranslation('attendanceWorkTime')
  const presets = useMemo(
    () => [
      { label: t('filter.today'), value: [dayjs().startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
      {
        label: t('filter.last7Days'),
        value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
      },
    ],
    [t],
  )

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-48">
        <RegionControl {...props} allRegionsLabel={t('filter.allRegions')} />
      </div>
      <div className="w-80">
        <DatePicker.RangePicker
          value={props.dateRange}
          onChange={(values) => props.onChangeDateRange(values as [Dayjs, Dayjs] | null)}
          showTime={{ format: 'HH:mm' }}
          format="YYYY-MM-DD HH:mm"
          inputReadOnly
          presets={presets}
          className="w-full"
          allowClear
        />
      </div>
    </div>
  )
}
