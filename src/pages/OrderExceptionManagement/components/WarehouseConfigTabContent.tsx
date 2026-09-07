import type { DataNode } from 'antd/es/tree'
import {
  Button,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Layout,
  Popconfirm,
  Select,
  Tag,
  Tree,
  Typography,
  Upload,
} from 'antd'
import type { UploadProps } from 'antd'
import {
  ChevronDown,
  Download,
  Globe2,
  MapPin,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Upload as UploadIcon,
  Warehouse,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type Key } from 'react'
import { useTranslation } from 'react-i18next'
import { showToast } from '../../../utils/toast'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import type { WarehouseCityId, WarehouseConfigDto, WarehouseProfileDto } from '../warehouseConfig/types'
import { WAREHOUSE_CITY_OPTIONS } from '../warehouseConfig/types'
import { validateWarehouseConfig } from '../warehouseConfig/validateWarehouseConfig'
function WarehouseTreeLeafTitle({
  profile,
  onDelete,
}: {
  profile: WarehouseProfileDto
  onDelete: (hubId: string) => void
}) {
  const { t } = useTranslation('orderException')
  const { t: tc } = useTranslation('common')
  return (
    <Flex align="center" justify="space-between" gap="small">
      <Flex align="center" gap="small" style={{ minWidth: 0, flex: 1 }}>
        <Typography.Text ellipsis>{profile.name}</Typography.Text>
        {profile.lossTimeoutDays ? (
          <Tag color="warning">{t('warehouseConfig.timeoutDaysTag', { days: profile.lossTimeoutDays })}</Tag>
        ) : null}
      </Flex>
      <span className="warehouse-delete-btn shrink-0 opacity-0 transition-opacity duration-150">
        <Popconfirm
          title={t('warehouseConfig.deleteHubTitle', { name: profile.name })}
          description={t('warehouseConfig.deleteHubDescription')}
          okText={tc('delete')}
          cancelText={tc('cancel')}
          okButtonProps={{ danger: true }}
          onConfirm={() => onDelete(profile.hubId)}
        >
          <Button
            type="link"
            danger
            className="!px-1"
            icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
            aria-label={t('warehouseConfig.deleteHubAria', { name: profile.name })}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </Popconfirm>
      </span>
    </Flex>
  )
}

type Props = {
  draftConfig: WarehouseConfigDto
  savedConfig: WarehouseConfigDto
  selectedHubId: string | null
  onDraftConfigChange: (next: WarehouseConfigDto) => void
  onSelectedHubIdChange: (hubId: string | null) => void
  onSave: () => Promise<void>
  onResetDefaults: () => void
  isSaving: boolean
}

function slugifyHubId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function TagListEditor({
  label,
  hint,
  values,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const { t } = useTranslation('orderException')
  return (
    <Form.Item
      label={
        <span className="inline-flex min-h-[2.5rem] items-end text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
          {label}
        </span>
      }
      extra={hint ? <span className="text-xs text-slate-500">{hint}</span> : undefined}
      className="mb-0"
    >
      <Select
        mode="tags"
        value={values}
        placeholder={placeholder ?? t('warehouseConfig.tagPlaceholder')}
        tokenSeparators={[',']}
        open={false}
        suffixIcon={null}
        onChange={(next) => onChange(next.map((item) => String(item).trim()).filter(Boolean))}
      />
    </Form.Item>
  )
}

function GlobalRulesSection({
  global,
  expanded,
  onToggle,
  onChange,
}: {
  global: WarehouseConfigDto['global']
  expanded: boolean
  onToggle: () => void
  onChange: (next: WarehouseConfigDto['global']) => void
}) {
  const { t } = useTranslation('orderException')
  return (
    <section className="border-b" style={{ borderColor: 'var(--admin-line)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50/80"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[#1f6f68]">
            <Globe2 className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">{t('warehouseConfig.globalRules')}</div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {t('warehouseConfig.globalSummary', {
                defaultDays: global.defaultLossTimeoutDays,
                thirdPartyDays: global.externalCarrierLossTimeoutDays,
                operatorCount: global.commonSystemOperators.length,
              })}
            </div>
          </div>
        </div>
        <ChevronDown
          className={[
            'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
            expanded ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden
        />
      </button>

      <div
        className={[
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        ].join(' ')}
      >
        <div className="overflow-hidden">
          <div
            className="space-y-5 border-t px-5 py-5"
            style={{ borderColor: 'var(--admin-line)', background: 'var(--admin-surface-soft)' }}
          >
            <Form layout="vertical">
            <div className="flex flex-wrap items-end gap-4">
              <Form.Item
                label={
                  <span className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                    {t('warehouseConfig.defaultTimeoutDays')}
                  </span>
                }
                tooltip={t('warehouseConfig.defaultTimeoutTooltip')}
                className="mb-0"
              >
                <InputNumber
                  min={1}
                  className="w-28"
                  value={global.defaultLossTimeoutDays}
                  onChange={(value) =>
                    onChange({
                      ...global,
                      defaultLossTimeoutDays: value ?? 1,
                    })
                  }
                />
              </Form.Item>
              <Form.Item
                label={
                  <span className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                    {t('warehouseConfig.thirdPartyTimeoutDays')}
                  </span>
                }
                className="mb-0"
              >
                <InputNumber
                  min={1}
                  className="w-28"
                  value={global.externalCarrierLossTimeoutDays}
                  onChange={(value) =>
                    onChange({
                      ...global,
                      externalCarrierLossTimeoutDays: value ?? 1,
                    })
                  }
                />
              </Form.Item>
              <div className="min-w-[160px] flex-1">
                <TagListEditor
                  label={t('warehouseConfig.globalSystemOperators')}
                  values={global.commonSystemOperators}
                  onChange={(commonSystemOperators) => onChange({ ...global, commonSystemOperators })}
                />
              </div>
              <div className="min-w-[160px] flex-1">
                <TagListEditor
                  label={t('warehouseConfig.globalNonRealOperators')}
                  values={global.commonNonRealOperators}
                  onChange={(commonNonRealOperators) => onChange({ ...global, commonNonRealOperators })}
                />
              </div>
              <div className="min-w-[160px] flex-1">
                <TagListEditor
                  label={t('warehouseConfig.globalNonRealPatterns')}
                  hint={t('warehouseConfig.globalNonRealPatternsHint')}
                  values={global.commonNonRealOperatorPatterns}
                  placeholder={t('warehouseConfig.patternPlaceholder')}
                  onChange={(commonNonRealOperatorPatterns) =>
                    onChange({ ...global, commonNonRealOperatorPatterns })
                  }
                />
              </div>
            </div>
            </Form>
          </div>
        </div>
      </div>
    </section>
  )
}

function ProfileEditor({
  profile,
  defaultLossTimeoutDays,
  onChange,
}: {
  profile: WarehouseProfileDto
  defaultLossTimeoutDays: number
  onChange: (next: WarehouseProfileDto) => void
}) {
  const { t } = useTranslation('orderException')
  const cityLabel =
    WAREHOUSE_CITY_OPTIONS.find((item) => item.value === profile.cityId)?.label ?? profile.cityId

  return (
    <div key={profile.hubId} className="warehouse-config-editor-enter space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-5" style={{ borderColor: 'var(--admin-line)' }}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold tracking-tight text-slate-950">{profile.name}</h3>
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--admin-sky-soft)] px-2 py-0.5 text-xs font-medium text-[#25526e] ring-1 ring-[#c8deee]">
              <MapPin className="h-3 w-3" aria-hidden />
              {cityLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t('warehouseConfig.hubNameHint')}</p>
        </div>
        <span className="font-mono text-[11px] text-slate-400">{profile.hubId}</span>
      </header>

      <section className="space-y-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          {t('warehouseConfig.matchingInfo')}
        </div>
        <Form layout="vertical" className="[&_.ant-form-item]:mb-0">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Form.Item
              label={
                <span className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                  {t('warehouseConfig.city')}
                </span>
              }
            >
              <Select<WarehouseCityId>
                value={profile.cityId}
                options={WAREHOUSE_CITY_OPTIONS}
                onChange={(cityId) => onChange({ ...profile, cityId })}
              />
            </Form.Item>
            <Form.Item
              label={
                <span className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                  {t('warehouseConfig.hubName')}
                </span>
              }
              tooltip={t('warehouseConfig.hubNameTooltip')}
            >
              <Input
                value={profile.name}
                placeholder={t('warehouseConfig.hubNamePlaceholder')}
                onChange={(e) => onChange({ ...profile, name: e.target.value })}
              />
            </Form.Item>
          </div>
        </Form>
      </section>

      <section className="space-y-4 border-t pt-6" style={{ borderColor: 'var(--admin-line)' }}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          {t('warehouseConfig.timeoutAndOperators')}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Form.Item
            label={
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                {t('warehouseConfig.hubLossTimeoutDays')}
              </span>
            }
            extra={
              <span className="text-xs text-slate-500">
                {t('warehouseConfig.hubLossTimeoutExtra', { days: defaultLossTimeoutDays })}
              </span>
            }
            className="mb-0"
          >
            <InputNumber
              min={1}
              className="w-full"
              placeholder={t('warehouseConfig.hubLossTimeoutPlaceholder', { days: defaultLossTimeoutDays })}
              value={profile.lossTimeoutDays}
              onChange={(value) =>
                onChange({
                  ...profile,
                  lossTimeoutDays: value ?? undefined,
                })
              }
            />
          </Form.Item>
          <TagListEditor
            label={t('warehouseConfig.hubNonRealOperators')}
            values={profile.nonRealOperators ?? []}
            onChange={(nonRealOperators) =>
              onChange({
                ...profile,
                nonRealOperators: nonRealOperators.length ? nonRealOperators : undefined,
              })
            }
          />
        </div>
      </section>
    </div>
  )
}

export function WarehouseConfigTabContent({
  draftConfig,
  savedConfig,
  selectedHubId,
  onDraftConfigChange,
  onSelectedHubIdChange,
  onSave,
  onResetDefaults,
  isSaving,
}: Props) {
  const { t } = useTranslation('orderException')
  const { t: tc } = useTranslation('common')
  const canEditConfig = usePermission(PERMISSION_KEYS.btnOrderExceptionConfigEdit)
  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState<WarehouseCityId | 'ALL'>('ALL')
  const [expandedTreeKeys, setExpandedTreeKeys] = useState<Key[]>([])
  const [globalExpanded, setGlobalExpanded] = useState(false)

  const isDirty = useMemo(
    () => JSON.stringify(draftConfig) !== JSON.stringify(savedConfig),
    [draftConfig, savedConfig]
  )

  const validationIssues = useMemo(() => validateWarehouseConfig(draftConfig), [draftConfig])

  const filteredProfiles = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return draftConfig.profiles.filter((profile) => {
      if (cityFilter !== 'ALL' && profile.cityId !== cityFilter) return false
      if (!needle) return true
      const haystack = [profile.name, profile.hubId].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [cityFilter, draftConfig.profiles, search])

  const warehouseTreeData = useMemo((): DataNode[] => {
    const byCity = new Map<WarehouseCityId, WarehouseProfileDto[]>()
    for (const profile of filteredProfiles) {
      const list = byCity.get(profile.cityId) ?? []
      list.push(profile)
      byCity.set(profile.cityId, list)
    }

    const cityOrder =
      cityFilter === 'ALL'
        ? WAREHOUSE_CITY_OPTIONS.map((item) => item.value)
        : [cityFilter]

    return cityOrder
      .filter((cityId) => byCity.has(cityId))
      .map((cityId) => {
        const profiles = byCity.get(cityId) ?? []
        const cityLabel = WAREHOUSE_CITY_OPTIONS.find((item) => item.value === cityId)?.label ?? cityId
        return {
          key: `city:${cityId}`,
          title: t('warehouseConfig.cityGroupCount', { city: cityLabel, count: profiles.length }),
          selectable: false,
          children: profiles.map((profile) => ({
            key: profile.hubId,
            title: profile.name,
            isLeaf: true,
          })),
        }
      })
  }, [cityFilter, filteredProfiles, t])

  useEffect(() => {
    const cityKeys = warehouseTreeData.map((node) => String(node.key))
    setExpandedTreeKeys((prev) => {
      const validPrev = prev.filter((key) => cityKeys.includes(String(key)))
      const newKeys = cityKeys.filter((key) => !validPrev.some((item) => String(item) === key))
      if (validPrev.length === 0) return cityKeys
      return [...validPrev, ...newKeys]
    })
  }, [warehouseTreeData])

  const selectedProfile =
    draftConfig.profiles.find((profile) => profile.hubId === selectedHubId) ?? null

  const updateProfile = useCallback(
    (hubId: string, next: WarehouseProfileDto) => {
      onDraftConfigChange({
        ...draftConfig,
        profiles: draftConfig.profiles.map((profile) =>
          profile.hubId === hubId ? next : profile
        ),
      })
      if (next.hubId !== hubId) onSelectedHubIdChange(next.hubId)
    },
    [draftConfig, onDraftConfigChange, onSelectedHubIdChange]
  )

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(draftConfig, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'warehouse-config.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [draftConfig])

  const handleImportFile = useCallback(
    (file: File) => {
      void file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as WarehouseConfigDto
          if (!parsed.global || !Array.isArray(parsed.profiles)) {
            throw new Error(t('warehouseConfig.invalidFormat'))
          }
          const issues = validateWarehouseConfig(parsed)
          if (issues.length) {
            showToast(issues[0].message, 'error')
            return
          }
          onDraftConfigChange(parsed)
          onSelectedHubIdChange(parsed.profiles[0]?.hubId ?? null)
          showToast(t('warehouseConfig.importedNotSaved'), 'success')
        } catch (e) {
          showToast((e as Error).message || tc('loadFailed'), 'error')
        }
      })
      return false
    },
    [onDraftConfigChange, onSelectedHubIdChange, t, tc],
  )

  const uploadProps: UploadProps = {
    accept: '.json,application/json',
    showUploadList: false,
    beforeUpload: handleImportFile,
  }

  const handleAddProfile = useCallback(() => {
    const name = t('warehouseConfig.newHubName')
    const hubId = `${slugifyHubId(name)}_${Date.now()}`
    const profile: WarehouseProfileDto = {
      cityId: 'SYD',
      hubId,
      name,
    }
    onDraftConfigChange({
      ...draftConfig,
      profiles: [...draftConfig.profiles, profile],
    })
    onSelectedHubIdChange(hubId)
  }, [draftConfig, onDraftConfigChange, onSelectedHubIdChange, t])

  const handleSave = useCallback(() => {
    if (validationIssues.length) {
      showToast(validationIssues[0].message, 'error')
      return
    }
    void onSave()
  }, [onSave, validationIssues])

  const handleDeleteProfile = useCallback(
    (hubId: string) => {
      if (draftConfig.profiles.length <= 1) {
        showToast(t('warehouseConfig.keepAtLeastOneHub'), 'error')
        return
      }
      const nextProfiles = draftConfig.profiles.filter((profile) => profile.hubId !== hubId)
      onDraftConfigChange({ ...draftConfig, profiles: nextProfiles })
      if (selectedHubId === hubId) {
        onSelectedHubIdChange(nextProfiles[0]?.hubId ?? null)
      }
      showToast(t('warehouseConfig.deletedNotSaved'), 'success')
    },
    [draftConfig, onDraftConfigChange, onSelectedHubIdChange, selectedHubId, t],
  )

  const handleTreeSelect = useCallback(
    (keys: Key[]) => {
      const hubId = String(keys[0] ?? '')
      if (!hubId || hubId.startsWith('city:')) return
      onSelectedHubIdChange(hubId)
    },
    [onSelectedHubIdChange]
  )

  return (
    <div className="warehouse-config">
      <div className="warehouse-config-workspace">
        <header
          className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4"
          style={{ borderColor: 'var(--admin-line)' }}
        >
          <div className="min-w-0">
            <div className="admin-eyebrow">{t('warehouseConfig.eyebrow')}</div>
            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-950">
              <Settings2 className="h-5 w-5 text-[#2f8f87]" aria-hidden />
              {t('warehouseConfig.title')}
            </h3>
            <p className="admin-description mt-1 max-w-2xl">{t('warehouseConfig.description')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Upload {...uploadProps} disabled={!canEditConfig}>
              <button type="button" className="admin-btn" disabled={!canEditConfig}>
                <UploadIcon className="h-4 w-4" aria-hidden />
                {t('warehouseConfig.import')}
              </button>
            </Upload>
            <button type="button" className="admin-btn" onClick={handleExport}>
              <Download className="h-4 w-4" aria-hidden />
              {t('warehouseConfig.export')}
            </button>
            <button
              type="button"
              className="admin-btn"
              onClick={onResetDefaults}
              disabled={!canEditConfig}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('warehouseConfig.resetDefaults')}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={!isDirty || !canEditConfig || isSaving}
              onClick={handleSave}
            >
              {isSaving ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              {t('warehouseConfig.saveConfig')}
            </button>
          </div>
        </header>

        <GlobalRulesSection
          global={draftConfig.global}
          expanded={globalExpanded}
          onToggle={() => setGlobalExpanded((prev) => !prev)}
          onChange={(global) => onDraftConfigChange({ ...draftConfig, global })}
        />

        <Layout hasSider className="min-h-[min(72vh,640px)]">
          <Layout.Sider
            width={300}
            theme="light"
            style={{ borderInlineEnd: '1px solid var(--admin-line)' }}
          >
            <Flex vertical gap="middle" style={{ padding: 12 }}>
              <Flex justify="space-between" align="center">
                <Typography.Text strong>{t('warehouseConfig.warehouseList')}</Typography.Text>
                <Typography.Text type="secondary">
                  {t('warehouseConfig.itemCount', { count: filteredProfiles.length })}
                </Typography.Text>
              </Flex>
              <Input.Search
                allowClear
                placeholder={t('warehouseConfig.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Flex gap="small">
                <Select<WarehouseCityId | 'ALL'>
                  style={{ flex: 1, minWidth: 0 }}
                  value={cityFilter}
                  options={[{ value: 'ALL', label: t('warehouseConfig.allCities') }, ...WAREHOUSE_CITY_OPTIONS]}
                  onChange={setCityFilter}
                />
                <Button icon={<Plus />} onClick={handleAddProfile} disabled={!canEditConfig}>
                  {t('warehouseConfig.createNew')}
                </Button>
              </Flex>
              {warehouseTreeData.length ? (
                <Tree
                  blockNode
                  showLine
                  className="[&_.ant-tree-switcher:not(.ant-tree-switcher-noop):hover:before]:!bg-transparent [&_.ant-tree-treenode:hover_.warehouse-delete-btn]:opacity-100 [&_.ant-tree-treenode:focus-within_.warehouse-delete-btn]:opacity-100"
                  expandedKeys={expandedTreeKeys}
                  onExpand={(keys) => setExpandedTreeKeys(keys)}
                  selectedKeys={selectedHubId ? [selectedHubId] : []}
                  treeData={warehouseTreeData}
                  onSelect={handleTreeSelect}
                  titleRender={(node) => {
                    if (!node.isLeaf) {
                      return <Typography.Text type="secondary">{String(node.title)}</Typography.Text>
                    }
                    const profile = draftConfig.profiles.find((item) => item.hubId === node.key)
                    if (!profile) return <span>{String(node.title)}</span>
                    return <WarehouseTreeLeafTitle profile={profile} onDelete={handleDeleteProfile} />
                  }}
                />
              ) : (
                <Empty description={t('warehouseConfig.noMatchingHub')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Flex>
          </Layout.Sider>

          <Layout.Content className="flex min-h-[360px] min-w-0 flex-col bg-white">
            {selectedProfile ? (
              <div className="flex-1 overflow-auto px-5 py-5 sm:px-6 sm:py-6">
                <ProfileEditor
                  profile={selectedProfile}
                  defaultLossTimeoutDays={draftConfig.global.defaultLossTimeoutDays}
                  onChange={(next) => updateProfile(selectedProfile.hubId, next)}
                />
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--admin-surface-soft)] text-slate-400 ring-1 ring-slate-200/80">
                  <Warehouse className="h-6 w-6" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-700">{t('warehouseConfig.selectHubToEdit')}</p>
                  <p className="mt-1 text-xs text-slate-500">{t('warehouseConfig.selectHubHint')}</p>
                </div>
              </div>
            )}
          </Layout.Content>
        </Layout>
      </div>
    </div>
  )
}
