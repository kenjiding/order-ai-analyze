import { Checkbox, Col, Collapse, Row } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionDefinition } from '../../../api/adminUsersApi'
import { getMenuGroupDefs } from '../../../components/Layout/sidebarMenu'

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

/** 容器台账/站点账户/流转记录的按钮权限合并到「容器管理」一组展示 */
const BUTTON_GROUP_BY_MENU: Record<string, string> = {
  'container-ledger': 'container',
  'container-accounts': 'container',
  'container-transfers': 'container',
}

const BUTTON_GROUP_META: Record<string, { sortOrder: number }> = {
  container: { sortOrder: 62 },
}

function groupButtonPermissionsByMenu(
  menuPermissions: PermissionDefinition[],
  buttonPermissions: PermissionDefinition[],
  groupTitle: (menuKey: string, fallback: string) => string,
  otherLabel: string,
): ButtonPermissionGroup[] {
  const menuLabelById = new Map(menuPermissions.map((item) => [menuIdFromKey(item.key), item.label]))
  const menuSortOrderById = new Map(menuPermissions.map((item) => [menuIdFromKey(item.key), item.sortOrder]))

  const grouped = new Map<string, PermissionDefinition[]>()
  const ungrouped: PermissionDefinition[] = []

  for (const item of buttonPermissions) {
    if (item.menuKey) {
      const groupKey = BUTTON_GROUP_BY_MENU[item.menuKey] ?? item.menuKey
      const bucket = grouped.get(groupKey) ?? []
      bucket.push(item)
      grouped.set(groupKey, bucket)
    } else {
      ungrouped.push(item)
    }
  }

  const groups = Array.from(grouped.entries())
    .map(([menuKey, items]) => ({
      menuKey,
      title: groupTitle(menuKey, menuLabelById.get(menuKey) ?? menuKey),
      sortOrder: BUTTON_GROUP_META[menuKey]?.sortOrder ?? menuSortOrderById.get(menuKey) ?? 9999,
      items: [...items].sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  if (ungrouped.length > 0) {
    groups.push({
      menuKey: '__other__',
      title: otherLabel,
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
  labelFor,
}: {
  items: PermissionDefinition[]
  value: string[]
  onChange?: (keys: string[]) => void
  disabled?: boolean
  labelFor: (item: PermissionDefinition) => string
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
                <span className="block text-sm font-medium leading-snug text-slate-900">{labelFor(item)}</span>
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

function MenuPermissionsGroupedSection({
  menuPermissions,
  value,
  onChange,
  disabled,
}: {
  menuPermissions: PermissionDefinition[]
  value: string[]
  onChange?: (keys: string[]) => void
  disabled?: boolean
}) {
  const { t: tp } = useTranslation('permission')
  const { t: tm } = useTranslation('menu')
  const { t } = useTranslation('systemUsers')
  const labelFor = (item: PermissionDefinition) => tp(item.key, { defaultValue: item.label })

  const groups = useMemo(() => {
    const groupDefs = getMenuGroupDefs()
    const permByKey = new Map(menuPermissions.map((p) => [p.key, p]))
    return groupDefs
      .map((def) => ({
        ...def,
        items: def.permissionKeys.flatMap((key) => {
          const perm = permByKey.get(key)
          return perm ? [perm] : []
        }),
      }))
      .filter((g) => g.items.length > 0)
  }, [menuPermissions])

  const selectedCount = menuPermissions.filter((item) => value.includes(item.key)).length

  const selectAll = () => {
    if (!onChange) return
    onChange(Array.from(new Set([...value, ...menuPermissions.map((item) => item.key)])))
  }

  const clearAll = () => {
    if (!onChange) return
    const menuKeys = new Set(menuPermissions.map((item) => item.key))
    onChange(value.filter((key) => !menuKeys.has(key)))
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
          <div className="text-sm font-semibold text-slate-900">{t('menuPermissions')}</div>
          <div className="mt-0.5 text-xs text-slate-500">{t('menuPermissionsHint')}</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
            {t('selectedCount', { selected: selectedCount, total: menuPermissions.length })}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={selectAll}
            className="rounded-md px-2 py-1 font-medium text-[#1f6f68] transition hover:bg-[var(--admin-accent-soft)] disabled:opacity-40"
          >
            {t('selectAll')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={clearAll}
            className="rounded-md px-2 py-1 font-medium text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:opacity-40"
          >
            {t('clearAll')}
          </button>
        </div>
      </div>

      <div className="space-y-5 p-4">
        {groups.map((group) => {
          const groupSelectedCount = group.items.filter((item) => value.includes(item.key)).length
          return (
            <div key={group.id}>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {tm(`groups.${group.id}`, { defaultValue: group.label })}
                </span>
                <div className="flex-1 border-t border-slate-200" />
                <span className="shrink-0 text-[11px] text-slate-400">
                  {t('selectedCount', { selected: groupSelectedCount, total: group.items.length })}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => selectGroup(group.items)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-[#1f6f68] transition hover:bg-[var(--admin-accent-soft)] disabled:opacity-40"
                >
                  {t('selectAll')}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => clearGroup(group.items)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:opacity-40"
                >
                  {t('clearAll')}
                </button>
              </div>
              <PermissionCheckboxGrid
                items={group.items}
                value={value}
                onChange={onChange}
                disabled={disabled}
                labelFor={labelFor}
              />
            </div>
          )
        })}
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
  const { t: tp } = useTranslation('permission')
  const { t: tm } = useTranslation('menu')
  const { t: tc } = useTranslation('common')
  const { t } = useTranslation('systemUsers')
  const labelFor = (item: PermissionDefinition) => tp(item.key, { defaultValue: item.label })

  const groupTitle = (menuKey: string, fallback: string) => {
    if (menuKey === 'container') return tp('groups.container')
    if (menuKey === '__other__') return tc('other')
    return tm(`items.${menuKey}`, { defaultValue: fallback })
  }

  const groups = useMemo(
    () => groupButtonPermissionsByMenu(menuPermissions, buttonPermissions, groupTitle, tc('other')),
    [buttonPermissions, menuPermissions, tp, tm, tc],
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
          <div className="text-sm font-semibold text-slate-900">{t('buttonPermissions')}</div>
          <div className="mt-0.5 text-xs text-slate-500">{t('buttonPermissionsHint')}</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-white px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200">
            {t('selectedCount', { selected: selectedCount, total: buttonPermissions.length })}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={selectAll}
            className="rounded-md px-2 py-1 font-medium text-[#1f6f68] transition hover:bg-[var(--admin-accent-soft)] disabled:opacity-40"
          >
            {t('selectAll')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => clearAll()}
            className="rounded-md px-2 py-1 font-medium text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:opacity-40"
          >
            {t('clearAll')}
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
                      {t('selectedCount', { selected: groupSelectedCount, total: group.items.length })}
                    </span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => selectGroup(group.items)}
                      className="rounded-md px-2 py-1 font-medium text-[#1f6f68] transition hover:bg-[var(--admin-accent-soft)] disabled:opacity-40"
                    >
                      {t('selectAll')}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => clearGroup(group.items)}
                      className="rounded-md px-2 py-1 font-medium text-slate-500 transition hover:bg-white hover:text-slate-700 disabled:opacity-40"
                    >
                      {t('clearAll')}
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
                    labelFor={labelFor}
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
      <MenuPermissionsGroupedSection
        menuPermissions={menuPermissions}
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
