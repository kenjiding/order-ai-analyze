import { Button, Image, Input, Modal, Radio, Table, Tooltip, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import type { ColumnsType } from 'antd/es/table'
import { Download, Image as ImageIcon, PencilLine, Plus, Send, Trash2, UploadCloud, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type Key } from 'react'
import { saveAs } from 'file-saver'
import { aggregateFleetRowsForRoute } from '../fleetSupplierAggregate'
import { captureFleetRouteReportPng } from '../fleetReportCapture'
import { parseFleetRouteCodes } from '../fleetRouteCodeParse'
import { parseFleetScanFiles } from '../fleetScanParse'
import { postFeishuPushImage, postFeishuPushText, summarizeFeishuPushImageFailure, summarizeFeishuTestFailure } from '../feishuWebhookTestApi'
import type { FleetSupplierConfig } from '../fleetSupplierPushTypes'
import { createFleetSupplierId } from '../fleetSupplierStorage'
import { loadFleetSuppliers, persistFleetSuppliers } from '../fleetSupplierRepository.idb'
import {
  buildFleetSuppliersXlsxBlob,
  mergeFleetSupplierImports,
  parseFleetSuppliersImportFile,
} from '../fleetSupplierExportImport'
import { readLocalPushImage, type LocalPushImage } from '../pushImageLocal'
import { withRetry } from '../feishuPushRetry'
import { showToast } from '../../../utils/toast'
import { confirmDialog } from '../../../utils/confirmDialog'
import { FleetSupplierEditModal } from './FleetSupplierEditModal'
import './fleetSupplierPushTab.css'

function truncateMiddle(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s
  const edge = Math.max(4, Math.floor((maxChars - 1) / 2))
  return `${s.slice(0, edge)}…${s.slice(s.length - edge)}`
}

type Props = {
  /**
   * `hidden`：独立入口页，供应商表中不展示 webhook/密钥，表单也不可编辑这两项（新建仍为空的 webhook）。
   * `full`：飞书推送页完整能力。
   */
  supplierSecretsVisibility?: 'full' | 'hidden'
}

export function FleetSupplierPushTab({
  supplierSecretsVisibility = 'full',
}: Props) {
  const [globalPushText, setGlobalPushText] = useState('')
  const [pushImages, setPushImages] = useState<LocalPushImage[]>([])
  const [suppliers, setSuppliers] = useState<FleetSupplierConfig[]>([])
  const [selectedSupplierKeys, setSelectedSupplierKeys] = useState<Key[]>([])

  const [scanRowCount, setScanRowCount] = useState(0)
  const [scanDropped, setScanDropped] = useState(0)
  const [scanFileLabel, setScanFileLabel] = useState('')
  const [scanRows, setScanRows] = useState<Awaited<ReturnType<typeof parseFleetScanFiles>>['rows']>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<FleetSupplierConfig | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importMerge, setImportMerge] = useState(true)
  const [importFileList, setImportFileList] = useState<UploadFile[]>([])
  const [importing, setImporting] = useState(false)

  const secretsHidden = supplierSecretsVisibility === 'hidden'
  const [pushing, setPushing] = useState(false)
  const [scanParsing, setScanParsing] = useState(false)
  const [pushImagesLoading, setPushImagesLoading] = useState(false)
  const scanFileInputRef = useRef<HTMLInputElement>(null)
  const pushImageInputRef = useRef<HTMLInputElement>(null)

  const hasScanData = scanRows.length > 0
  const hasPushImages = pushImages.length > 0

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await loadFleetSuppliers()
      if (!cancelled) setSuppliers(list)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const supplierIdSet = useMemo(() => new Set(suppliers.map((s) => s.id)), [suppliers])
  const effectiveSelectedKeys = useMemo(
    () => selectedSupplierKeys.filter((id) => supplierIdSet.has(String(id))),
    [selectedSupplierKeys, supplierIdSet],
  )

  const hasTypedContentForPush = useMemo(() => {
    const g0 = globalPushText.trim()
    if (g0.length > 0) return true
    const sel = new Set(effectiveSelectedKeys.map(String))
    return suppliers.some((s) => sel.has(s.id) && s.pushContent.trim().length > 0)
  }, [globalPushText, effectiveSelectedKeys, suppliers])

  const persist = useCallback(
    async (next: FleetSupplierConfig[]) => {
      setSuppliers(next)
      try {
        await persistFleetSuppliers(next)
      } catch (e) {
        const msg = e instanceof Error ? e.message : '未知错误'
        showToast(`供应商配置保存失败：${msg}`, 'error')
        try {
          const restored = await loadFleetSuppliers()
          setSuppliers(restored)
        } catch {
          /* ignore */
        }
        throw e
      }
    },
    [],
  )

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (row: FleetSupplierConfig) => {
    setEditing(row)
    setModalOpen(true)
  }

  const handleScanFiles = async (files: File[]) => {
    if (!files.length) return
    setScanParsing(true)
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    try {
      const parsed = await parseFleetScanFiles(files)
      if (!parsed.rows.length) {
        showToast('扫描文件未解析到含「路由编码」的有效行，请检查表头与内容。', 'error')
        setScanRows([])
        setScanRowCount(0)
        setScanDropped(parsed.droppedRows)
        setScanFileLabel(parsed.fileNames.join('、'))
        return
      }
      setScanRows(parsed.rows)
      setScanRowCount(parsed.rows.length)
      setScanDropped(parsed.droppedRows)
      setScanFileLabel(parsed.fileNames.join('、'))
      showToast(
        `已读取扫描文件 ${parsed.fileNames.length} 个，有效行 ${parsed.rows.length}（跳过 ${parsed.droppedRows} 行缺路由编码）。`,
        'success'
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : '解析失败'
      showToast(`扫描文件解析失败：${msg}`, 'error')
      setScanRows([])
      setScanRowCount(0)
      setScanDropped(0)
      setScanFileLabel('')
    } finally {
      setScanParsing(false)
    }
  }

  const handleCommitted = async (values: Omit<FleetSupplierConfig, 'id'>) => {
    try {
      if (editing) {
        const next = suppliers.map((s) =>
          s.id === editing.id ? { ...editing, ...values, id: editing.id } : s,
        )
        await persist(next)
        showToast(`已更新供应商「${values.supplierName || editing.supplierName}」。`, 'success')
      } else {
        await persist([...suppliers, { id: createFleetSupplierId(), ...values }])
        showToast(`已添加供应商「${values.supplierName}」。`, 'success')
      }
      setModalOpen(false)
      setEditing(null)
    } catch {
      /* persist 已提示 */
    }
  }

  const removeSupplier = async (row: FleetSupplierConfig) => {
    try {
      await persist(suppliers.filter((s) => s.id !== row.id))
      showToast(`已移除「${row.supplierName}」。`, 'success')
    } catch {
      /* persist 已提示 */
    }
  }

  const removePushImage = (id: string) => {
    setPushImages((prev) => prev.filter((img) => img.id !== id))
  }

  const onPushImagesInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files?.length ? Array.from(e.target.files) : []
    e.target.value = ''
    if (!list.length) return
    void (async () => {
            setPushImagesLoading(true)
      const added: LocalPushImage[] = []
      const errs: string[] = []
      try {
        for (const file of list) {
          try {
            added.push(await readLocalPushImage(file))
          } catch (err) {
            errs.push(err instanceof Error ? err.message : `「${file.name}」读取失败`)
          }
        }
        if (added.length) {
          setPushImages((prev) => [...prev, ...added])
        }
        if (errs.length === 1) {
          showToast(errs[0]!, 'error')
        } else if (errs.length > 1) {
          showToast(errs.join('；'), 'error')
        }
      } finally {
        setPushImagesLoading(false)
      }
    })()
  }

  const openPushImagePicker = () => {
    if (pushImagesLoading) return
    pushImageInputRef.current?.click()
  }

  const pushCustomImagesToWebhook = async (
    s: FleetSupplierConfig,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const failures: string[] = []
    for (const img of pushImages) {
      const res = await withRetry(() =>
        postFeishuPushImage({
          webhookUrl: s.webhookUrl,
          signingSecret: s.signingSecret,
          imageBase64: img.dataUrl,
          headlineText: '',
        }),
      )
      if (res.ok !== true) {
        failures.push(summarizeFeishuPushImageFailure(res))
      }
    }
    if (failures.length > 0) {
      return { ok: false, error: failures.join('；') }
    }
    return { ok: true }
  }

  const handlePushAll = async () => {
    const g = globalPushText.trim()
    if (scanParsing) {
      return
    }
    if (!suppliers.length) {
      showToast('请先添加至少一个供应商。', 'error')
      return
    }

    const targets = suppliers.filter((s) => effectiveSelectedKeys.includes(s.id))
    if (!targets.length) {
      showToast('请至少勾选一家需要推送的供应商。', 'error')
      return
    }

    const hasScan = scanRows.length > 0
    if (!hasScan && !hasPushImages) {
      const canText = g.length > 0 || targets.some((s) => s.pushContent.trim().length > 0)
      if (!canText) {
        showToast(
          '未上传扫描文件时，请先填写「推送内容」、所选供应商的「供应商推送内容」，或添加推送图片。',
          'error'
        )
        return
      }
    }

    setPushing(true)
    const errors: string[] = []
    const oks: string[] = []

    try {
      for (const s of targets) {
        const supplierPart = s.pushContent.trim()
        const globalPart = g
        const mergedHeadline = [supplierPart, globalPart].filter((x) => x.length > 0).join('\n\n')
        const textBody = mergedHeadline.trim()
        const headlineBase =
          textBody || `「${s.supplierName || '供应商'}」货量统计报表`
        if (!s.webhookUrl.trim()) {
          errors.push(`「${s.supplierName}」：未配置 webhook。`)
          continue
        }

        if (!hasScan) {
          if (!textBody && !hasPushImages) {
            errors.push(`「${s.supplierName}」：未填写可推送文案，也未添加推送图片。`)
            continue
          }

          let supplierOk = true
          if (textBody) {
            const textRes = await withRetry(() =>
              postFeishuPushText({
                webhookUrl: s.webhookUrl,
                signingSecret: s.signingSecret,
                text: textBody,
              }),
            )
            if (textRes.ok !== true) {
              errors.push(`「${s.supplierName}」：${summarizeFeishuTestFailure(textRes)}`)
              supplierOk = false
            }
          }

          if (hasPushImages) {
            const imgRes = await pushCustomImagesToWebhook(s)
            if (imgRes.ok !== true) {
              errors.push(`「${s.supplierName}」：${imgRes.error}`)
              supplierOk = false
            }
          }

          if (supplierOk) {
            oks.push(s.supplierName || s.routeCode)
          }
          continue
        }

        const routeCodes = parseFleetRouteCodes(s.routeCode)
        if (!routeCodes.length) {
          errors.push(`「${s.supplierName}」：未配置有效路由编码。`)
          continue
        }

        const buckets = aggregateFleetRowsForRoute(scanRows, s.routeCode)
        const total = buckets.reduce((sum, b) => sum + b.total, 0)
        if (!total) {
          errors.push(`「${s.supplierName}」：路由「${routeCodes.join('、')}」无匹配数据，已跳过。`)
          continue
        }

        let png: string
        try {
          png = await captureFleetRouteReportPng({
            title: `${s.supplierName || '供应商'} · 货量汇总`,
            subtitle: ``,
            buckets,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : '截图失败'
          errors.push(`「${s.supplierName}」：${msg}`)
          continue
        }

        let textSent = false
        let hasPartialError = false
        if (textBody) {
          const textRes = await withRetry(() =>
            postFeishuPushText({
              webhookUrl: s.webhookUrl,
              signingSecret: s.signingSecret,
              text: textBody,
            }),
          )
          if (textRes.ok !== true) {
            errors.push(`「${s.supplierName}」：${summarizeFeishuTestFailure(textRes)}`)
            hasPartialError = true
          } else {
            textSent = true
          }
        }

        if (hasPushImages) {
          const customRes = await pushCustomImagesToWebhook(s)
          if (customRes.ok !== true) {
            errors.push(`「${s.supplierName}」：${customRes.error}`)
            hasPartialError = true
          }
        }

        const reportHeadline = textSent ? '' : headlineBase
        const res = await withRetry(() =>
          postFeishuPushImage({
            webhookUrl: s.webhookUrl,
            signingSecret: s.signingSecret,
            imageBase64: png,
            headlineText: reportHeadline,
          }),
        )

        if (res.ok === true) {
          if (!hasPartialError) {
            oks.push(s.supplierName || s.routeCode)
          }
        } else {
          errors.push(`「${s.supplierName}」：${summarizeFeishuPushImageFailure(res)}`)
        }
      }

      const imageHint = hasPushImages ? '图片、' : ''
      if (errors.length === 0) {
        showToast(
          hasScan
            ? `已向 ${oks.length} 家供应商推送${imageHint}报表图与文案。`
            : `已向 ${oks.length} 家供应商推送${hasPushImages ? '图片与' : ''}文案。`,
          'success'
        )
      } else if (oks.length === 0) {
        showToast(errors.join(' '), 'error')
      } else {
        showToast(`已推送 ${oks.length} 家：${oks.join('、')}。失败：${errors.join(' ')}`, 'success')
      }
    } finally {
      setPushing(false)
    }
  }

  const onScanFilesPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const { files } = e.target
    const list = files?.length ? Array.from(files) : []
    e.target.value = ''
    if (!list.length) return
    void handleScanFiles(list)
  }

  const openScanFilePicker = () => {
    if (scanParsing) return
    scanFileInputRef.current?.click()
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
    if (!file) {
      showToast('请先选择文件。', 'error')
      return
    }
    setImporting(true)
    try {
      const r = await parseFleetSuppliersImportFile(file)
      if (!r.ok) {
        showToast(r.error, 'error')
        return
      }
      if (importMerge) {
        const next = mergeFleetSupplierImports(suppliers, r.suppliers)
        try {
          await persist(next)
          closeImportModal()
          showToast(`已合并导入 ${r.suppliers.length} 条（相同 id 以文件为准）。`, 'success')
        } catch {
          /* persist 已提示 */
        }
        return
      }
      const confirmed = await confirmDialog({
        title: '确认替换全部本地供应商？',
        content: `将删除当前 ${suppliers.length} 条配置，仅保留文件中的 ${r.suppliers.length} 条。`,
        okText: '替换',
        danger: true,
      })
      if (!confirmed) return
      try {
        await persist(r.suppliers)
        closeImportModal()
        showToast(`已导入并替换为 ${r.suppliers.length} 条供应商。`, 'success')
      } catch {
        /* persist 已提示 */
      }
    } finally {
      setImporting(false)
    }
  }

  const columns: ColumnsType<FleetSupplierConfig> = (() => {
    const secretCols: ColumnsType<FleetSupplierConfig> = [
      {
        title: '飞书 webhook',
        dataIndex: 'webhookUrl',
        key: 'webhookUrl',
        render: (url: string) => (
          <Tooltip title={url}>
            <span className="block max-w-[min(420px,50vw)] font-mono text-xs text-slate-700">
              {truncateMiddle(url || '', 48)}
            </span>
          </Tooltip>
        ),
      },
      {
        title: '密钥',
        key: 'signingSecret',
        width: 80,
        render: (_, row) =>
          row.signingSecret ? (
            <span className="text-[var(--admin-accent)]">已配置</span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
      },
    ]

    return [
      {
        title: '供应商名称',
        dataIndex: 'supplierName',
        key: 'supplierName',
        width: 160,
        ellipsis: true,
      },
      {
        title: '路由编码',
        dataIndex: 'routeCode',
        key: 'routeCode',
        width: 120,
        ellipsis: true,
      },
      ...(secretsHidden ? [] : secretCols),
      {
        title: '供应商推送内容',
        dataIndex: 'pushContent',
        key: 'pushContent',
        ellipsis: true,
        render: (t: string) =>
          t?.trim() ? (
            t
          ) : (
            <span className="text-slate-400" title="推送时仅拼接外层「推送内容」">
              （未填供应商段）
            </span>
          ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 150,
        fixed: 'right',
        render: (_, row) => (
          <div className="flex flex-nowrap items-center gap-0">
            <Button type="link" className="!px-1" icon={<PencilLine className="h-3.5 w-3.5" />} onClick={() => openEdit(row)}>
              编辑
            </Button>
            <Button type="link" className="!px-1" danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeSupplier(row)}>
              删除
            </Button>
          </div>
        ),
      },
    ]
  })()

  return (
    <div className="fleet-supplier-push-tab space-y-5">
      <div className="fs-card">
        <div className="fs-card-head">
          <div>
            <div className="fs-card-head-title">推送文案与扫描文件</div>
          </div>
        </div>
        <div className="fs-card-body space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-[var(--admin-muted)]">推送内容</div>
            <Input.TextArea
              rows={4}
              value={globalPushText}
              onChange={(e) => setGlobalPushText(e.target.value)}
              placeholder="通用段落；与各供应商「供应商推送内容」组合后推送。可不传扫描文件，仅推文字或图片。"
              className="!text-sm"
            />
          </div>
          <div className="fs-toolbar">
            <input
              ref={scanFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={onScanFilesPicked}
            />
            <input
              ref={pushImageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={onPushImagesInputChange}
            />
            <Button type="default" icon={<UploadCloud className="h-4 w-4" />} loading={scanParsing} onClick={openScanFilePicker}>
              {scanParsing ? '正在解析…' : '选择扫描文件'}
            </Button>
            <Button
              type="default"
              icon={<ImageIcon className="h-4 w-4" />}
              loading={pushImagesLoading}
              onClick={openPushImagePicker}
            >
              {pushImagesLoading ? '正在读取…' : '选择推送图片'}
            </Button>
            <Button
              type="primary"
              icon={<Send className="h-4 w-4" />}
              loading={pushing}
              disabled={
                scanParsing ||
                !suppliers.length ||
                effectiveSelectedKeys.length === 0 ||
                (!hasScanData && !hasTypedContentForPush && !hasPushImages)
              }
              onClick={() => void handlePushAll()}
            >
              推送所选供应商
            </Button>
            <Button type="dashed" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
              添加供应商
            </Button>
            {scanParsing ? (
              <span className="text-xs text-[var(--admin-muted)]">正在读取并解析表格…</span>
            ) : null}
            {scanFileLabel ? (
              <div className="fs-file-pill">
                <span className="truncate">
                  {scanFileLabel} · {scanRowCount} 行{scanDropped ? ` · 跳过 ${scanDropped}` : ''}
                </span>
              </div>
            ) : null}
            {pushImages.length > 0 ? (
              <div className="fs-file-pill">
                <span>推送图片 {pushImages.length} 张</span>
              </div>
            ) : null}
          </div>
          {pushImages.length > 0 ? (
            <Image.PreviewGroup>
              <ul className="fs-push-images" aria-label="待推送图片预览">
                {pushImages.map((img) => (
                  <li key={img.id} className="fs-push-image-item">
                    <div className="fs-push-image-thumb-wrap">
                      <Image
                        src={img.dataUrl}
                        alt={img.name}
                        width={96}
                        height={96}
                        className="fs-push-image-thumb !rounded-md"
                        preview={{ mask: '预览' }}
                      />
                      <button
                        type="button"
                        className="fs-push-image-remove"
                        aria-label={`移除 ${img.name}`}
                        onClick={() => removePushImage(img.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="fs-push-image-name" title={img.name}>
                      {img.name}
                    </span>
                  </li>
                ))}
              </ul>
            </Image.PreviewGroup>
          ) : null}
        </div>
      </div>

      <div className="fs-card">
        <div className="fs-card-head">
          <div className="fs-card-head-title">供应商配置</div>
          <div className="flex flex-wrap items-center gap-2">
            {!secretsHidden ? (
              <Button type="default" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportSuppliers}>
                导出配置
              </Button>
            ) : null}
            <Button type="default" onClick={openImportModal}>
              导入供应商配置
            </Button>
            <span className="fs-badge-count">
              已选 {effectiveSelectedKeys.length} / {suppliers.length} 家
            </span>
          </div>
        </div>
        <div className="fs-card-body !pt-3">
          <div className="fs-supplier-table-wrap">
            <Table<FleetSupplierConfig>
              rowKey="id"
              columns={columns}
              dataSource={suppliers}
              pagination={false}
              rowSelection={{
                selectedRowKeys: effectiveSelectedKeys,
                onChange: setSelectedSupplierKeys,
                columnWidth: 44,
              }}
              locale={{
                emptyText: secretsHidden
                  ? '暂无供应商，可点击「添加供应商」「导入供应商配置」，或在「飞书推送」页维护含 webhook 的完整信息。'
                  : '暂无供应商，请点击「添加供应商」维护路由与 webhook。',
              }}
              scroll={{ x: secretsHidden ? 720 : 1060 }}
            />
          </div>
        </div>
      </div>

      <FleetSupplierEditModal
        open={modalOpen}
        editing={editing}
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
            支持 xlsx、xls、csv、json。列名可与导出文件一致（英文字段），也可使用中文表头（如「供应商名称」「路由编码」等）。完整 webhook
            / 密钥请在「飞书推送」页导出或向东道主索取含密文的表格后再于此处导入。
          </p>
        </div>
      </Modal>
    </div>
  )
}
