import { Checkbox, Col, Row } from 'antd'
import type { PermissionDefinition } from '../../../api/adminUsersApi'

type PermissionCheckboxGroupProps = {
  menuPermissions: PermissionDefinition[]
  buttonPermissions: PermissionDefinition[]
  value?: string[]
  onChange?: (keys: string[]) => void
  disabled?: boolean
}

function PermissionSection({
  title,
  hint,
  items,
  value,
  onChange,
  disabled,
}: {
  title: string
  hint: string
  items: PermissionDefinition[]
  value: string[]
  onChange?: (keys: string[]) => void
  disabled?: boolean
}) {
  const selectedCount = items.filter((item) => value.includes(item.key)).length

  const toggle = (key: string, checked: boolean) => {
    if (!onChange) return
    if (checked) {
      onChange(Array.from(new Set([...value, key])))
      return
    }
    onChange(value.filter((item) => item !== key))
  }

  const selectAll = () => {
    if (!onChange) return
    onChange(Array.from(new Set([...value, ...items.map((item) => item.key)])))
  }

  const clearSection = () => {
    if (!onChange) return
    const sectionKeys = new Set(items.map((item) => item.key))
    onChange(value.filter((key) => !sectionKeys.has(key)))
  }

  return (
    <section className="rounded-xl border border-slate-200/90 bg-slate-50/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
            已选 {selectedCount}/{items.length}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={selectAll}
            className="rounded-md px-2 py-1 font-medium text-[#1f6f68] transition hover:bg-[var(--admin-accent-soft)] disabled:opacity-40"
          >
            全选
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={clearSection}
            className="rounded-md px-2 py-1 font-medium text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:opacity-40"
          >
            清空
          </button>
        </div>
      </div>

      <div className="p-4">
        <Row gutter={[12, 12]}>
          {items.map((item) => {
            const checked = value.includes(item.key)
            return (
              <Col xs={24} sm={12} md={6} key={item.key}>
                <label
                  className={[
                    'flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition',
                    checked
                      ? 'border-[rgba(47,143,135,0.35)] bg-[var(--admin-accent-soft)] shadow-[inset_0_0_0_1px_rgba(47,143,135,0.12)]'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80',
                    disabled ? 'cursor-not-allowed opacity-60' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <Checkbox
                    disabled={disabled}
                    checked={checked}
                    onChange={(e) => toggle(item.key, e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug text-slate-900">{item.label}</span>
                    {item.description ? (
                      <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{item.description}</span>
                    ) : null}
                  </span>
                </label>
              </Col>
            )
          })}
        </Row>
      </div>
    </section>
  )
}

export default function PermissionCheckboxGroup({
  menuPermissions,
  buttonPermissions,
  value = [],
  onChange,
  disabled,
}: PermissionCheckboxGroupProps) {
  return (
    <div className="space-y-4">
      <PermissionSection
        title="菜单权限"
        hint="控制侧边栏可见模块"
        items={menuPermissions}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <PermissionSection
        title="按钮权限"
        hint="控制页面内导出、编辑、分析等操作"
        items={buttonPermissions}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  )
}
