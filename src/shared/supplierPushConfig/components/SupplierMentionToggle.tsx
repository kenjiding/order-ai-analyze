import { Checkbox } from 'antd'

type Props = {
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

/**
 * 「是否 @ 相关人员」勾选框：勾选后推送时会 @ 供应商配置花名册第 1 位外部联系人
 * （花名册在「车队供应商推送」-「供应商配置」里维护）。4 个定时推送抽屉共用。
 */
export function SupplierMentionToggle({ value, onChange, disabled = false }: Props) {
  return (
    <Checkbox checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)}>
      <span className="text-sm">@ 相关人员</span>
    </Checkbox>
  )
}
