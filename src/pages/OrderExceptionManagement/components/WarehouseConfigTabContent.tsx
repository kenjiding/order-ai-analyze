import type { DataNode } from 'antd/es/tree'
import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Tree,
  Typography,
  Upload,
} from 'antd'
import type { UploadProps } from 'antd'
import { Download, Plus, RotateCcw, Save, Trash2, Upload as UploadIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type Key } from 'react'
import { showToast } from '../../../utils/toast'
import type { WarehouseCityId, WarehouseConfigDto, WarehouseProfileDto } from '../warehouseConfig/types'
import { WAREHOUSE_CITY_OPTIONS } from '../warehouseConfig/types'
import {
  validateWarehouseConfig,
} from '../warehouseConfig/validateWarehouseConfig'

const { Text } = Typography

function WarehouseTreeLeafTitle({
  profile,
  onDelete,
}: {
  profile: WarehouseProfileDto
  onDelete: (hubId: string) => void
}) {
  return (
    <Flex align="center" justify="space-between" gap="small" className="w-full pr-1">
      <Flex align="center" gap="small" className="min-w-0 flex-1">
        <span className="truncate">{profile.name}</span>
        {profile.lossTimeoutDays ? (
          <Typography.Text type="warning" className="shrink-0 text-xs">
            {profile.lossTimeoutDays}天
          </Typography.Text>
        ) : null}
      </Flex>
      <span className="warehouse-delete-btn shrink-0 opacity-0 transition-opacity duration-150">
        <Popconfirm
          title={`删除「${profile.name}」？`}
          description="删除后需保存配置才会在分析中生效。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDelete(profile.hubId)}
        >
          <Button
            type="text"
            size="small"
            danger
            icon={<Trash2 className="h-3.5 w-3.5" />}
            aria-label={`删除 ${profile.name}`}
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
  values,
  onChange,
  placeholder,
}: {
  label: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  return (
    <Form.Item label={label} className="mb-0">
      <Select
        mode="tags"
        value={values}
        placeholder={placeholder ?? '输入后回车添加'}
        tokenSeparators={[',']}
        open={false}
        suffixIcon={null}
        onChange={(next) => onChange(next.map((item) => String(item).trim()).filter(Boolean))}
      />
    </Form.Item>
  )
}

function GlobalRulesPanel({
  global,
  onChange,
}: {
  global: WarehouseConfigDto['global']
  onChange: (next: WarehouseConfigDto['global']) => void
}) {
  return (
    <Collapse
      className="admin-panel overflow-hidden bg-white [&_.ant-collapse-header]:items-center!"
      items={[
        {
          key: 'global',
          label: (
            <span>
              全局规则{' '}
              <Text type="secondary" className="text-xs font-normal">
                （默认超时、全局操作员与正则）
              </Text>
            </span>
          ),
          children: (
            <Space direction="vertical" size="middle" className="w-full">
              <Flex gap="middle" wrap="wrap">
                <Form.Item label="默认库内/库外丢失超时（天）" className="mb-0 min-w-[200px] flex-1">
                  <InputNumber
                    min={1}
                    className="w-full"
                    value={global.defaultLossTimeoutDays}
                    onChange={(value) =>
                      onChange({
                        ...global,
                        defaultLossTimeoutDays: value ?? 1,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="3PL 丢件超时（天）" className="mb-0 min-w-[200px] flex-1">
                  <InputNumber
                    min={1}
                    className="w-full"
                    value={global.externalCarrierLossTimeoutDays}
                    onChange={(value) =>
                      onChange({
                        ...global,
                        externalCarrierLossTimeoutDays: value ?? 1,
                      })
                    }
                  />
                </Form.Item>
              </Flex>
              <TagListEditor
                label="全局系统操作员"
                values={global.commonSystemOperators}
                onChange={(commonSystemOperators) => onChange({ ...global, commonSystemOperators })}
              />
              <TagListEditor
                label="全局非真实操作员"
                values={global.commonNonRealOperators}
                onChange={(commonNonRealOperators) => onChange({ ...global, commonNonRealOperators })}
              />
              <TagListEditor
                label="全局非真实操作员正则"
                values={global.commonNonRealOperatorPatterns}
                placeholder="例如 ^[A-Z]{2,5}\\s+OPS\\d+$"
                onChange={(commonNonRealOperatorPatterns) =>
                  onChange({ ...global, commonNonRealOperatorPatterns })
                }
              />
            </Space>
          ),
        },
      ]}
    />
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
  return (
    <Form layout="vertical" className="[&_.ant-form-item]:mb-0">
      <Flex gap="middle" wrap="wrap">
        <Form.Item label="城市" className="min-w-[140px] flex-1">
          <Select<WarehouseCityId>
            value={profile.cityId}
            options={WAREHOUSE_CITY_OPTIONS}
            onChange={(cityId) => onChange({ ...profile, cityId })}
          />
        </Form.Item>
        <Form.Item
          label="仓库名"
          tooltip="须与轨迹【】内仓库名一致，分析据此匹配"
          className="min-w-[180px] flex-1"
        >
          <Input
            value={profile.name}
            placeholder="如 MEL CSP 1"
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
          />
        </Form.Item>
      </Flex>

      <div className="mt-4">
        <TagListEditor
          label="额外轨迹别名（可选）"
          values={profile.extraAliases ?? []}
          placeholder="轨迹中还有其它写法时添加，如 ADL Center"
          onChange={(extraAliases) =>
            onChange({
              ...profile,
              extraAliases: extraAliases.length ? extraAliases : undefined,
            })
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 mt-4">
        <Form.Item
          label={`仓库丢失超时（天，留空则用全局 ${defaultLossTimeoutDays} 天）`}
          className="sm:col-span-1 xl:col-span-2"
        >
          <InputNumber
            min={1}
            className="w-full"
            placeholder={`默认 ${defaultLossTimeoutDays}`}
            value={profile.lossTimeoutDays}
            onChange={(value) =>
              onChange({
                ...profile,
                lossTimeoutDays: value ?? undefined,
              })
            }
          />
        </Form.Item>
        <div className="sm:col-span-1 xl:col-span-2">
          <TagListEditor
            label="仓库非真实操作员"
            values={profile.nonRealOperators ?? []}
            onChange={(nonRealOperators) =>
              onChange({
                ...profile,
                nonRealOperators: nonRealOperators.length ? nonRealOperators : undefined,
              })
            }
          />
        </div>
      </div>
    </Form>
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
  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState<WarehouseCityId | 'ALL'>('ALL')
  const [expandedTreeKeys, setExpandedTreeKeys] = useState<Key[]>([])

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
      const haystack = [profile.name, profile.hubId, ...(profile.extraAliases ?? [])]
        .join(' ')
        .toLowerCase()
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
          title: `${cityLabel}（${profiles.length}）`,
          selectable: false,
          children: profiles.map((profile) => ({
            key: profile.hubId,
            title: profile.name,
            isLeaf: true,
          })),
        }
      })
  }, [cityFilter, filteredProfiles])

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
            throw new Error('格式不正确')
          }
          const issues = validateWarehouseConfig(parsed)
          if (issues.length) {
            showToast(issues[0].message, 'error')
            return
          }
          onDraftConfigChange(parsed)
          onSelectedHubIdChange(parsed.profiles[0]?.hubId ?? null)
          showToast('已导入配置（尚未保存）', 'success')
        } catch (e) {
          showToast((e as Error).message || '导入失败', 'error')
        }
      })
      return false
    },
    [onDraftConfigChange, onSelectedHubIdChange]
  )

  const uploadProps: UploadProps = {
    accept: '.json,application/json',
    showUploadList: false,
    beforeUpload: handleImportFile,
  }

  const handleAddProfile = useCallback(() => {
    const name = '新仓库'
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
  }, [draftConfig, onDraftConfigChange, onSelectedHubIdChange])

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
        showToast('至少保留一个仓库配置', 'error')
        return
      }
      const nextProfiles = draftConfig.profiles.filter((profile) => profile.hubId !== hubId)
      onDraftConfigChange({ ...draftConfig, profiles: nextProfiles })
      if (selectedHubId === hubId) {
        onSelectedHubIdChange(nextProfiles[0]?.hubId ?? null)
      }
      showToast('已删除（尚未保存）', 'success')
    },
    [draftConfig, onDraftConfigChange, onSelectedHubIdChange, selectedHubId]
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
    <div className="space-y-4">
      <GlobalRulesPanel
        global={draftConfig.global}
        onChange={(global) => onDraftConfigChange({ ...draftConfig, global })}
      />

      <Card className="admin-panel" styles={{ body: { padding: 16 } }}>
        <Flex wrap="wrap" gap="small" align="center">
          <Input.Search
            allowClear
            placeholder="搜索仓库名 / 别名"
            className="max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select<WarehouseCityId | 'ALL'>
            className="min-w-[120px]"
            value={cityFilter}
            options={[{ value: 'ALL', label: '全部城市' }, ...WAREHOUSE_CITY_OPTIONS]}
            onChange={setCityFilter}
          />
          <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={handleAddProfile}>
            新建仓库
          </Button>
          <Flex wrap="wrap" gap="small" className="ml-auto">
            <Upload {...uploadProps}>
              <Button icon={<UploadIcon className="h-4 w-4" />}>导入</Button>
            </Upload>
            <Button icon={<Download className="h-4 w-4" />} onClick={handleExport}>
              导出
            </Button>
            <Button icon={<RotateCcw className="h-4 w-4" />} onClick={onResetDefaults}>
              恢复默认
            </Button>
            <Button
              type="primary"
              icon={<Save className="h-4 w-4" />}
              loading={isSaving}
              disabled={!isDirty}
              onClick={handleSave}
            >
              保存配置
            </Button>
          </Flex>
        </Flex>

        <div className="mt-3 space-y-2">
          {isDirty ? (
            <Alert type="warning" showIcon message="有未保存的修改；分析时将使用上次保存的版本。" />
          ) : (
            <Alert type="success" showIcon message="配置已保存，下次分析将使用当前版本。" />
          )}
          {validationIssues.length ? (
            <Alert type="error" showIcon message={validationIssues[0].message} />
          ) : null}
        </div>
      </Card>

      <Flex gap="middle" align="flex-start" className="flex-col lg:flex-row">
        <Card
          className="admin-panel w-full shrink-0 lg:w-[34%] lg:max-w-[360px]"
          title="仓库列表"
          styles={{ body: { padding: '8px 12px', maxHeight: 720, overflow: 'auto' } }}
        >
          {warehouseTreeData.length ? (
            <Tree
              blockNode
              showLine
              className="[&_.ant-tree-treenode:focus-within_.warehouse-delete-btn]:opacity-100 [&_.ant-tree-treenode:hover_.warehouse-delete-btn]:opacity-100"
              expandedKeys={expandedTreeKeys}
              onExpand={(keys) => setExpandedTreeKeys(keys)}
              selectedKeys={selectedHubId ? [selectedHubId] : []}
              treeData={warehouseTreeData}
              onSelect={handleTreeSelect}
              titleRender={(node) => {
                if (!node.isLeaf) {
                  return <span className="font-medium">{String(node.title)}</span>
                }
                const profile = draftConfig.profiles.find((item) => item.hubId === node.key)
                if (!profile) return <span>{String(node.title)}</span>
                return <WarehouseTreeLeafTitle profile={profile} onDelete={handleDeleteProfile} />
              }}
            />
          ) : (
            <Empty description="无匹配仓库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>

        <Card
          className="admin-panel min-h-[420px] flex-1"
          title={selectedProfile ? '编辑仓库' : '仓库详情'}
          styles={{ body: { padding: 20 } }}
        >
          {selectedProfile ? (
            <ProfileEditor
              profile={selectedProfile}
              defaultLossTimeoutDays={draftConfig.global.defaultLossTimeoutDays}
              onChange={(next) => updateProfile(selectedProfile.hubId, next)}
            />
          ) : (
            <Empty description="请从左侧选择一个仓库进行编辑" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>
      </Flex>
    </div>
  )
}
