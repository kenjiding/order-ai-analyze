import { Button, Modal, Radio, Table, Tooltip, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import type { ColumnsType } from 'antd/es/table'
import { Download, PencilLine, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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

function formatMentionNames(contacts: SupplierPushConfig['mentionOpenIds'] | undefined): string {
  const list = contacts ?? []
  const names = list.map((c) => c.name.trim()).filter(Boolean)
  if (names.length > 0) return names.join('、')
  if (list.length > 0) return `${list.length} 人`
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
        else showToast(`加载供应商配置失败：${res.error}`, 'error')
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
      if (!res.ok) { showToast(`更新失败：${res.error}`, 'error'); return }
      setSuppliers((prev) => prev.map((s) => s.id === editing.id ? res.data : s))
      showToast(`已更新供应商「${values.supplierNickname || editing.supplierNickname}」。`, 'success')
    } else {
      const res = await apiCreateFleetSupplier(values)
      if (!res.ok) { showToast(`添加失败：${res.error}`, 'error'); return }
      setSuppliers((prev) => [...prev, res.data])
      showToast(`已添加供应商「${values.supplierNickname}」。`, 'success')
    }
    setModalOpen(false)
    setEditing(null)
  }

  const removeSupplier = async (row: SupplierPushConfig) => {
    const confirmed = await confirmDialog({
      title: `确认删除「${supplierDisplayName(row)}」？`,
      content: '删除后各推送业务已勾选的该供应商会一并失效，且不可恢复。',
      okText: '删除',
      danger: true,
    })
    if (!confirmed) return
    const res = await apiDeleteFleetSupplier(row.id)
    if (!res.ok) { showToast(`删除失败：${res.error}`, 'error'); return }
    setSuppliers((prev) => prev.filter((s) => s.id !== row.id))
    showToast(`已移除「${supplierDisplayName(row)}」。`, 'success')
  }

  const handleExportSuppliers = useCallback(() => {
    if (!suppliers.length) {
      showToast('暂无供应商可导出。', 'error')
      return
    }
    const blob = buildFleetSuppliersXlsxBlob(suppliers, { includeSecrets: !secretsHidden })
    const stamp = new Date().toISOString().slice(0, 10)
    saveAs(blob, `fleet-supplier-config-${stamp}.xlsx`)
    showToast(
      secretsHidden
        ? '已导出 xlsx（不含 webhook / 密钥列）。'
        : '已导出 xlsx（含 webhook / 密钥，请妥善保管）。',
      'success'
    )
  }, [suppliers, secretsHidden])

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
    if (!file) { showToast('请先选择文件。', 'error'); return }
    setImporting(true)
    try {
      const r = await parseFleetSuppliersImportFile(file, { vendors })
      if (!r.ok) { showToast(r.error, 'error'); return }
      if (!importMerge) {
        const confirmed = await confirmDialog({
          title: '确认替换全部供应商配置？',
          content: `将删除当前 ${suppliers.length} 条配置，仅保留文件中的 ${r.suppliers.length} 条${
            r.skipped > 0 ? `（另有 ${r.skipped} 条因缺少 vendorCode 将跳过）` : ''
          }。`,
          okText: '替换',
          danger: true,
        })
        if (!confirmed) return
      }
      const res = await apiImportFleetSuppliers(importMerge ? 'merge' : 'replace', r.suppliers)
      if (!res.ok) { showToast(`导入失败：${res.error}`, 'error'); return }
      setSuppliers(res.data)
      closeImportModal()
      const skipNote = r.skipped > 0 ? `，跳过 ${r.skipped} 条（缺少 vendorCode 且无法匹配主数据）` : ''
      showToast(
        importMerge
          ? `已合并导入 ${res.imported} 条（相同 id 以文件为准）${skipNote}`
          : `已导入并替换为 ${res.imported} 条供应商${skipNote}`,
        'success',
      )
    } finally {
      setImporting(false)
    }
  }

  const columns: ColumnsType<SupplierPushConfig> = useMemo(() => [
    {
      title: '供应商',
      key: 'vendor',
      width: 200,
      render: (_, row) => (
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-800">{supplierDisplayName(row)}</span>
            {row.regionCode === LEGACY_GLOBAL_SUPPLIER_REGION_CODE ? (
              <Tooltip title="迁移前的历史配置，不属于某个州，全部州共享可见、可编辑">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">历史·全部州</span>
              </Tooltip>
            ) : null}
          </div>
          <div className="text-xs text-slate-400">{row.vendorCode || '—'}</div>
        </div>
      ),
    },
    { title: '路由编码', dataIndex: 'routeCode', key: 'routeCode', width: 120, ellipsis: true },
    {
      title: '路由码白名单',
      dataIndex: 'routeCodeWhitelist',
      key: 'routeCodeWhitelist',
      width: 140,
      ellipsis: true,
      render: (v: string) => (v?.trim() ? v : <span className="text-slate-400">—</span>),
    },
    {
      title: '站点编码',
      dataIndex: 'stationCode',
      key: 'stationCode',
      width: 110,
      ellipsis: true,
      render: (v: string) => (v?.trim() ? v : <span className="text-slate-400">—</span>),
    },
    {
      title: '飞书群名称',
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
      title: '@ 相关人员',
      key: 'mentionOpenIds',
      width: 180,
      ellipsis: true,
      render: (_, row) => {
        const label = formatMentionNames(row.mentionOpenIds)
        return label ? label : <span className="text-slate-400">—</span>
      },
    },
    {
      title: '供应商推送内容',
      dataIndex: 'pushContent',
      key: 'pushContent',
      ellipsis: true,
      render: (t: string) =>
        t?.trim() ? (
          stripEditorContentForPreview(t)
        ) : (
          <span className="text-slate-400" title="推送时仅拼接外层「推送内容」">
            （未填供应商段）
          </span>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <div className="flex flex-nowrap items-center gap-0">
          <Button type="link" className="!px-1" icon={<PencilLine className="h-3.5 w-3.5" />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button type="link" className="!px-1" danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void removeSupplier(row)}>
            删除
          </Button>
        </div>
      ),
    },
  ], [chatNameById])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            添加供应商
          </Button>
          {!secretsHidden ? (
            <Button type="default" icon={<Download className="h-4 w-4" />} onClick={handleExportSuppliers}>
              导出配置
            </Button>
          ) : null}
          <Button type="default" onClick={openImportModal}>
            导入供应商配置
          </Button>
        </div>
        <span className="text-xs text-[var(--admin-muted)]">共 {suppliers.length} 家供应商</span>
      </div>

      <Table<SupplierPushConfig>
        rowKey="id"
        columns={columns}
        dataSource={suppliers}
        loading={configsLoading}
        pagination={false}
        locale={{ emptyText: '暂无供应商，请点击「添加供应商」或「导入供应商配置」维护。' }}
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
        title="导入供应商配置"
        open={importOpen}
        onCancel={closeImportModal}
        onOk={() => void runImport()}
        okText="开始导入"
        confirmLoading={importing}
        destroyOnHidden
      >
        <div className="space-y-3 pt-1">
          <Radio.Group
            value={importMerge ? 'merge' : 'replace'}
            onChange={(e) => setImportMerge(e.target.value === 'merge')}
          >
            <div className="flex flex-col gap-2">
              <Radio value="merge">合并（相同 id 以文件为准，其余保留）</Radio>
              <Radio value="replace">全部替换（清空现有列表后仅保留文件中的条目）</Radio>
            </div>
          </Radio.Group>
          <Upload
            accept=".xlsx,.xls,.csv,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            maxCount={1}
            fileList={importFileList}
            beforeUpload={() => false}
            onChange={({ fileList }) => setImportFileList(fileList)}
          >
            <Button type="default">选择文件</Button>
          </Upload>
          <p className="text-xs text-slate-500">
            支持 xlsx、xls、csv、json。列名可与导出文件一致（vendorCode、vendorName、supplierNickname 等），也可使用中文表头。
            旧版 supplierName 列会回填为 supplierNickname；vendorCode 须来自文件列或能匹配供应商主数据，无法确定的行将跳过。
            {secretsHidden
              ? ' 完整 webhook / 密钥请在「系统管理 → 供应商配置」导出或向东道主索取含密文的表格后再于此处导入。'
              : null}
          </p>
        </div>
      </Modal>
    </div>
  )
}
