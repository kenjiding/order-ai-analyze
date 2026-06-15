import { Checkbox, Col, Collapse, Row } from 'antd'
import { useMemo } from 'react'
import type { PermissionDefinition } from '../../../api/adminUsersApi'

type PermissionCheckboxGroupProps = {
  menuPermissions: PermissionDefinition[]
  buttonPermissions: PermissionDefinition[]
  value?: string[]
  onChange?: (keys: string[]) => void
  disabled?: boolean
}

type ButtonPermissionGroup = {
  menuKey: string
  title: string
  sortOrder: number
  items: PermissionDefinition[]
}

function menuIdFromKey(menuPermissionKey: string): string {
  return menuPermissionKey.replace(/^menu:/, '')
}

function groupButtonPermissionsByMenu(
  menuPermissions: PermissionDefinition[],
  buttonPermissions: PermissionDefinition[],
): ButtonPermissionGroup[] {
  const menuLabelById = new Map(menuPermissions.map((item) => [menuIdFromKey(item.key), item.label]))
  const menuSortOrderById = new Map(menuPermissions.map((item) => [menuIdFromKey(item.key), item.sortOrder]))

  const grouped = new Map<string, PermissionDefinition[]>()
  const ungrouped: PermissionDefinition[] = []

  for (const item of buttonPermissions) {
    if (item.menuKey) {
      const bucket = grouped.get(item.menuKey) ?? []
      bucket.push(item)
      grouped.set(item.menuKey, bucket)
    } else {
      ungrouped.push(item)
    }
  }

  const groups = Array.from(grouped.entries())
    .map(([menuKey, items]) => ({
      menuKey,
      title: menuLabelById.get(menuKey) ?? menuKey,
      sortOrder: menuSortOrderById.get(menuKey) ?? 9999,
      items: [...items].sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  if (ungrouped.length > 0) {
    groups.push({
      menuKey: '__other__',
      title: '其他',
      sortOrder: 99999,
      items: [...ungrouped].sort((a, b) => a.sortOrder - b.sortOrder),
    })
  }

  return groups
}

function PermissionCheckboxGrid({
  items,
  value,
  onChange,
  disabled,
}: {
  items: PermissionDefinition[]
  value: string[]
  onChange?: (keys: string[]) => void
  disabled?: boolean
}) {
  const toggle = (key: string, checked: boolean) => {
    if (!onChange) return
    if (checked) {
      onChange(Array.from(new Set([...value, key])))
      return
    }
    onChange(value.filter((item) => item !== key))
  }

  return (
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
  )
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
        <PermissionCheckboxGrid items={items} value={value} onChange={onChange} disabled={disabled} />
      </div>
    </section>
  )
}

function ButtonPermissionsGroupedSection({
  menuPermissions,
  buttonPermissions,
  value,
  onChange,
  disabled,
}: {
  menuPermissions: PermissionDefinition[]
  buttonPermissions: PermissionDefinition[]
  value: string[]
  onChange?: (keys: string[]) => void
  disabled?: boolean
}) {
  const groups = useMemo(
    () => groupButtonPermissionsByMenu(menuPermissions, buttonPermissions),
    [buttonPermissions, menuPermissions],
  )

  const selectedCount = buttonPermissions.filter((item) => value.includes(item.key)).length

  const selectAll = () => {
    if (!onChange) return
    onChange(Array.from(new Set([...value, ...buttonPermissions.map((item) => item.key)])))
  }

  const clearAll = () => {
    if (!onChange) return
    const buttonKeys = new Set(buttonPermissions.map((item) => item.key))
    onChange(value.filter((key) => !buttonKeys.has(key)))
  }

  const selectGroup = (items: PermissionDefinition[]) => {
    if (!onChange) return
    onChange(Array.from(new Set([...value, ...items.map((item) => item.key)])))
  }

  const clearGroup = (items: PermissionDefinition[]) => {
    if (!onChange) return
    const groupKeys = new Set(items.map((item) => item.key))
    onChange(value.filter((key) => !groupKeys.has(key)))
  }

  return (
    <section className="rounded-xl border border-slate-200/90 bg-slate-50/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">按钮权限</div>
          <div className="mt-0.5 text-xs text-slate-500">按所属页面分组，控制各模块内的导出、编辑、推送等操作</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
            已选 {selectedCount}/{buttonPermissions.length}
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
            onClick={clearAll}
            className="rounded-md px-2 py-1 font-medium text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:opacity-40"
          >
            清空
          </button>
        </div>
      </div>

      <div className="p-4">
        <Collapse
          bordered={false}
          defaultActiveKey={[]}
          className="permission-button-groups !bg-transparent"
          items={groups.map((group) => {
            const groupSelectedCount = group.items.filter((item) => value.includes(item.key)).length
            return {
              key: group.menuKey,
              label: (
                <div className="flex flex-wrap items-center justify-between gap-2 pr-2">
                  <div className="text-sm font-medium text-slate-800">{group.title}</div>
                  <div
                    className="flex items-center gap-2 text-xs"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <span className="rounded-full bg-white px-2 py-0.5 font-medium text-slate-600 ring-1 ring-slate-200">
                      已选 {groupSelectedCount}/{group.items.length}
                    </span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => selectGroup(group.items)}
                      className="rounded-md px-2 py-1 font-medium text-[#1f6f68] transition hover:bg-[var(--admin-accent-soft)] disabled:opacity-40"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => clearGroup(group.items)}
                      className="rounded-md px-2 py-1 font-medium text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:opacity-40"
                    >
                      清空
                    </button>
                  </div>
                </div>
              ),
              children: (
                <div className="pt-1">
                  <PermissionCheckboxGrid
                    items={group.items}
                    value={value}
                    onChange={onChange}
                    disabled={disabled}
                  />
                </div>
              ),
              className:
                'overflow-hidden !mb-3 !rounded-lg !border !border-slate-200/90 !bg-white/70 [&:last-child]:!mb-0',
            }
          })}
        />
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
      <ButtonPermissionsGroupedSection
        menuPermissions={menuPermissions}
        buttonPermissions={buttonPermissions}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  )
}
