import { Select, Space } from 'antd'

type DriverOption = { courierCode: string; courierName: string }

export function DriverFilterBar({
  drivers,
  courierCode,
  onCourierChange,
}: {
  drivers: DriverOption[]
  courierCode: string | undefined
  onCourierChange: (courierCode: string | undefined) => void
}) {
  return (
    <Space size={12} wrap>
      <Select
        allowClear
        placeholder="按司机筛选"
        style={{ minWidth: 200 }}
        value={courierCode}
        onChange={(v) => onCourierChange(v)}
        options={drivers.map((d) => ({ label: d.courierName || d.courierCode, value: d.courierCode }))}
      />
    </Space>
  )
}
