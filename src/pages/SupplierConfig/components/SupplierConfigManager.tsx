import { Button, Modal, Radio, Table, Tooltip, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import type { ColumnsType } from 'antd/es/table'
import { Download, PencilLine, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { saveAs } from 'file-saver'
import { stripEditorContentForPreview } from '../../../components/FeishuLarkMdEditor'
import { fetchFeishuAppBotChats } from '../../PushNotifications/feishuWebhookTestApi'
import {
  apiCreateFleetSupplier,
  apiDeleteFleetSupplier,
  apiImportFleetSuppliers,
  apiLoadFleetSuppliers,
  apiUpdateFleetSupplier,
} from '../../PushNotifications/fleetSupplierApi'
import {
  buildFleetSuppliersXlsxBlob,
  parseFleetSuppliersImportFile,
} from '../../PushNotifications/fleetSupplierExportImport'
import { FleetSupplierEditModal } from '../../PushNotifications/components/FleetSupplierEditModal'
import { fetchVendors } from '../../VendorAnalysis/vendorAnalysisApi'
import { useAppSettings } from '../../../context/AppSettingsContext'
import {
  LEGACY_GLOBAL_SUPPLIER_REGION_CODE,
  supplierDisplayName,
  truncateSupplierFieldMid,
  type SupplierPushConfig,
  type SupplierPushConfigDraft,
} from '../../../shared/supplierPushConfig'
import { confirmDialog } from '../../../utils/confirmDialog'
import { showToast } from '../../../utils/toast'

function formatMentionNames(
  contacts: SupplierPushConfig['mentionOpenIds'] | undefined,
  peopleLabel: (count: number) => string,
): string {
  const list = contacts ?? []
  const names = list.map((c) => c.name.trim()).filter(Boolean)
  if (names.length > 0) return names.join('、')
  if (list.length > 0) return peopleLabel(list.length)
  return ''
}

type Props = {
  /**
   * `hidden`：独立入口页，表单不可编辑 webhook/密钥，导出不含密文。
   * `full`：系统管理页完整能力，表单可维护 webhook/密钥。
   */
  secretsVisibility?: 'full' | 'hidden'
}

/**
 * 供应商配置维护：新增/编辑/删除/导入/导出全局供应商 catalog。
 * 各推送业务只读取该 catalog 并各自勾选推送对象，不在此处维护启用状态。
 */
export function SupplierConfigManager({ secretsVisibility = 'full' }: Props) {
  const { t } = useTranslation('supplierConfig')
  const { t: tc } = useTranslation('common')
  const { imileToken } = useAppSettings()
  const secretsHidden = secretsVisibility === 'hidden'

  const [suppliers, setSuppliers] = useState<SupplierPushConfig[]>([])
  const [configsLoading, setConfigsLoading] = useState(true)
  const [chatNameById, setChatNameById] = useState<Map<string, string>>(new Map())
  const [vendors, setVendors] = useState<Array<{ vendorCode: string; vendorNameEn: string }>>([])
  const [vendorsLoading, setVendorsLoading] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SupplierPushConfig | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importMerge, setImportMerge] = useState(true)
  const [importFileList, setImportFileList] = useState<UploadFile[]>([])
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setConfigsLoading(true)
      const res = await apiLoadFleetSuppliers()
      if (!cancelled) {
        if (res.ok) setSuppliers(res.data)
        else showToast(t('loadFailed', { error: res.error }), 'error')
        setConfigsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetchFeishuAppBotChats().then((res) => {
      if (cancelled || !res.ok) return
      setChatNameById(new Map(res.chats.map((c) => [c.chatId, c.name])))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setVendorsLoading(true)
    void fetchVendors(imileToken).then((res) => {
      if (cancelled) return
      setVendorsLoading(false)
      if (res.ok) {
        setVendors(res.data.map((v) => ({ vendorCode: v.vendorCode, vendorNameEn: v.vendorNameEn })))
      }
    })
    return () => { cancelled = true }
  }, [imileToken])

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (row: SupplierPushConfig) => {
    setEditing(row)
    setModalOpen(true)
  }

  const handleCommitted = async (values: SupplierPushConfigDraft) => {
    if (editing) {
      const res = await apiUpdateFleetSupplier(editing.id, values)
      if (!res.ok) { showToast(t('updateFailed', { error: res.error }), 'error'); return }
      setSuppliers((prev) => prev.map((s) => s.id === editing.id ? res.data : s))
      showToast(t('toastUpdated', { name: values.supplierNickname || editing.supplierNickname }), 'success')
    } else {
      const res = await apiCreateFleetSupplier(values)
      if (!res.ok) { showToast(t('addFailed', { error: res.error }), 'error'); return }
      setSuppliers((prev) => [...prev, res.data])
      showToast(t('toastAdded', { name: values.supplierNickname }), 'success')
    }
    setModalOpen(false)
    setEditing(null)
  }

  const removeSupplier = async (row: SupplierPushConfig) => {
    const confirmed = await confirmDialog({
      title: t('confirmDeleteTitle', { name: supplierDisplayName(row) }),
      content: t('confirmDeleteContent'),
      okText: tc('delete'),
      danger: true,
    })
    if (!confirmed) return
    const res = await apiDeleteFleetSupplier(row.id)
    if (!res.ok) { showToast(t('deleteFailed', { error: res.error }), 'error'); return }
    setSuppliers((prev) => prev.filter((s) => s.id !== row.id))
    showToast(t('toastRemoved', { name: supplierDisplayName(row) }), 'success')
  }

  const handleExportSuppliers = useCallback(() => {
    if (!suppliers.length) {
      showToast(t('exportEmpty'), 'error')
      return
    }
    const blob = buildFleetSuppliersXlsxBlob(suppliers, { includeSecrets: !secretsHidden })
    const stamp = new Date().toISOString().slice(0, 10)
    saveAs(blob, `fleet-supplier-config-${stamp}.xlsx`)
    showToast(secretsHidden ? t('exportNoSecrets') : t('exportWithSecrets'), 'success')
  }, [suppliers, secretsHidden, t])

  const openImportModal = () => {
    setImportMerge(true)
    setImportFileList([])
    setImportOpen(true)
  }

  const closeImportModal = () => {
    setImportOpen(false)
    setImportFileList([])
  }

  const runImport = async () => {
    const raw = importFileList[0]?.originFileObj
    const file = raw instanceof File ? raw : undefined
    if (!file) { showToast(t('selectFileFirst'), 'error'); return }
    setImporting(true)
    try {
      const r = await parseFleetSuppliersImportFile(file, { vendors })
      if (!r.ok) { showToast(r.error, 'error'); return }
      if (!importMerge) {
        const confirmed = await confirmDialog({
          title: t('confirmReplaceTitle'),
          content: t('confirmReplaceContent', {
            current: suppliers.length,
            incoming: r.suppliers.length,
            skipNote: r.skipped > 0 ? t('confirmReplaceSkip', { skipped: r.skipped }) : '',
          }),
          okText: t('replaceOk'),
          danger: true,
        })
        if (!confirmed) return
      }
      const res = await apiImportFleetSuppliers(importMerge ? 'merge' : 'replace', r.suppliers)
      if (!res.ok) { showToast(t('importFailed', { error: res.error }), 'error'); return }
      setSuppliers(res.data)
      closeImportModal()
      const skipNote = r.skipped > 0 ? t('importSkipNote', { skipped: r.skipped }) : ''
      showToast(
        importMerge
          ? t('importMergeSuccess', { count: res.imported, skipNote })
          : t('importReplaceSuccess', { count: res.imported, skipNote }),
        'success',
      )
    } finally {
      setImporting(false)
    }
  }

  const columns: ColumnsType<SupplierPushConfig> = useMemo(() => [
    {
      title: t('colVendor'),
      key: 'vendor',
      width: 200,
      render: (_, row) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-800">{supplierDisplayName(row)}</span>
            {row.regionCode === LEGACY_GLOBAL_SUPPLIER_REGION_CODE ? (
              <Tooltip title={t('legacyAllRegionsTip')}>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{t('legacyAllRegions')}</span>
              </Tooltip>
            ) : null}
          </div>
          <div className="text-xs text-slate-400">
            {row.vendorCode || (
              <Tooltip title={t('routeOnlyMatchTip')}>
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">{t('routeOnlyMatch')}</span>
              </Tooltip>
            )}
          </div>
        </div>
      ),
    },
    { title: t('colRouteCode'), dataIndex: 'routeCode', key: 'routeCode', width: 120, ellipsis: true },
    {
      title: t('colRouteWhitelist'),
      dataIndex: 'routeCodeWhitelist',
      key: 'routeCodeWhitelist',
      width: 140,
      ellipsis: true,
      render: (v: string) => (v?.trim() ? v : <span className="text-slate-400">—</span>),
    },
    {
      title: t('colStationCode'),
      dataIndex: 'stationCode',
      key: 'stationCode',
      width: 110,
      ellipsis: true,
      render: (v: string) => (v?.trim() ? v : <span className="text-slate-400">—</span>),
    },
    {
      title: t('colChatName'),
      key: 'chatName',
      width: 180,
      ellipsis: true,
      render: (_, row) => {
        const chatId = row.chatId?.trim()
        if (!chatId) return <span className="text-slate-400">—</span>
        const name = chatNameById.get(chatId)?.trim()
        if (name) return name
        return (
          <Tooltip title={chatId}>
            <span>{truncateSupplierFieldMid(chatId, 24)}</span>
          </Tooltip>
        )
      },
    },
    {
      title: t('colMention'),
      key: 'mentionOpenIds',
      width: 180,
      ellipsis: true,
      render: (_, row) => {
        const label = formatMentionNames(row.mentionOpenIds, (count) => t('mentionPeople', { count }))
        return label ? label : <span className="text-slate-400">—</span>
      },
    },
    {
      title: t('colPushContent'),
      dataIndex: 'pushContent',
      key: 'pushContent',
      ellipsis: true,
      render: (content: string) =>
        content?.trim() ? (
          stripEditorContentForPreview(content)
        ) : (
          <span className="text-slate-400" title={t('emptyPushContentTip')}>
            {t('emptyPushContent')}
          </span>
        ),
    },
    {
      title: t('colActions'),
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <div className="flex flex-nowrap items-center gap-0">
          <Button type="link" className="!px-1" icon={<PencilLine className="h-3.5 w-3.5" />} onClick={() => openEdit(row)}>
            {t('edit')}
          </Button>
          <Button type="link" className="!px-1" danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void removeSupplier(row)}>
            {t('delete')}
          </Button>
        </div>
      ),
    },
  ], [chatNameById, t])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            {t('addSupplier')}
          </Button>
          {!secretsHidden ? (
            <Button type="default" icon={<Download className="h-4 w-4" />} onClick={handleExportSuppliers}>
              {t('exportConfig')}
            </Button>
          ) : null}
          <Button type="default" onClick={openImportModal}>
            {t('importConfig')}
          </Button>
        </div>
        <span className="text-xs text-[var(--admin-muted)]">{t('supplierCount', { count: suppliers.length })}</span>
      </div>

      <Table<SupplierPushConfig>
        rowKey="id"
        columns={columns}
        dataSource={suppliers}
        loading={configsLoading}
        pagination={false}
        locale={{ emptyText: t('emptyTable') }}
        scroll={{ x: 1100 }}
      />

      <FleetSupplierEditModal
        open={modalOpen}
        editing={editing}
        vendors={vendors}
        vendorsLoading={vendorsLoading}
        secretsVisibility={secretsHidden ? 'hidden' : 'full'}
        onCancel={() => {
          setModalOpen(false)
          setEditing(null)
        }}
        onCommitted={handleCommitted}
      />

      <Modal
        title={t('importTitle')}
        open={importOpen}
        onCancel={closeImportModal}
        onOk={() => void runImport()}
        okText={t('importStart')}
        confirmLoading={importing}
        destroyOnHidden
      >
        <div className="space-y-3 pt-1">
          <Radio.Group
            value={importMerge ? 'merge' : 'replace'}
            onChange={(e) => setImportMerge(e.target.value === 'merge')}
          >
            <div className="flex flex-col gap-2">
              <Radio value="merge">{t('importMerge')}</Radio>
              <Radio value="replace">{t('importReplace')}</Radio>
            </div>
          </Radio.Group>
          <Upload
            accept=".xlsx,.xls,.csv,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            maxCount={1}
            fileList={importFileList}
            beforeUpload={() => false}
            onChange={({ fileList }) => setImportFileList(fileList)}
          >
            <Button type="default">{t('selectFile')}</Button>
          </Upload>
          <p className="text-xs text-slate-500">
            {t('importHint')}
            {secretsHidden ? t('importSecretsHint') : null}
          </p>
        </div>
      </Modal>
    </div>
  )
}
