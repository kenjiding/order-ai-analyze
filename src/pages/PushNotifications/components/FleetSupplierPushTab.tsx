import { Button, Image, Modal, Radio, Select, Switch, Table, Tooltip, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import type { ColumnsType } from 'antd/es/table'
import { AlertTriangle, CloudRain, Download, Image as ImageIcon, PencilLine, Plus, RefreshCw, Send, Trash2, UploadCloud, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type Key } from 'react'
import { saveAs } from 'file-saver'
import { aggregateFleetRowsForRoute } from '../fleetSupplierAggregate'
import { captureFleetRouteReportPng } from '../fleetReportCapture'
import { parseFleetRouteCodes } from '../fleetRouteCodeParse'
import { parseFleetScanFiles } from '../fleetScanParse'
import { fetchDeliveryWeatherLarkMd, summarizeFeishuTestFailure } from '../feishuWebhookTestApi'
import { WEATHER_LOCATION_PRESETS } from '../weatherLocations'
import { readWeatherPushSettings, writeWeatherPushSettings } from '../weatherPushSettings'
import {
  FeishuLarkMdEditor,
  hasEditorContent,
  mergeEditorHtmlParts,
  prepareFleetRichPayload,
  stripEditorContentForPreview,
} from '../../../components/FeishuLarkMdEditor'
import { pushFleetRichMessage } from '../pushFleetRichMessage'
import type { FleetSupplierConfig, FleetSupplierConfigDraft } from '../fleetSupplierPushTypes'
import { LEGACY_GLOBAL_SUPPLIER_REGION_CODE, supplierDisplayName } from '../fleetSupplierPushTypes'
import {
  apiCreateFleetSupplier,
  apiDeleteFleetSupplier,
  apiImportFleetSuppliers,
  apiLoadFleetSuppliers,
  apiUpdateFleetSupplier,
} from '../fleetSupplierApi'
import {
  buildFleetSuppliersXlsxBlob,
  parseFleetSuppliersImportFile,
} from '../fleetSupplierExportImport'
import { readLocalPushImage, type LocalPushImage } from '../pushImageLocal'
import { withRetry } from '../feishuPushRetry'
import { showToast } from '../../../utils/toast'
import { confirmDialog } from '../../../utils/confirmDialog'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { useAppSettings } from '../../../context/AppSettingsContext'
import { fetchVendors } from '../../VendorAnalysis/vendorAnalysisApi'
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
  const { imileToken } = useAppSettings()
  const canSend = usePermission(PERMISSION_KEYS.btnPushNotificationsFleetSupplier)
  const [globalPushText, setGlobalPushText] = useState('')
  // 天气预报开关与城市：从 localStorage 恢复，设置一次后长期保留
  const [weatherEnabled, setWeatherEnabled] = useState(() => readWeatherPushSettings().enabled)
  const [weatherCity, setWeatherCity] = useState(() => readWeatherPushSettings().city)

  useEffect(() => {
    writeWeatherPushSettings({ enabled: weatherEnabled, city: weatherCity })
  }, [weatherEnabled, weatherCity])
  const [pushImages, setPushImages] = useState<LocalPushImage[]>([])
  const [suppliers, setSuppliers] = useState<FleetSupplierConfig[]>([])
  const [vendors, setVendors] = useState<Array<{ vendorCode: string; vendorNameEn: string }>>([])
  const [vendorsLoading, setVendorsLoading] = useState(false)
  const [configsLoading, setConfigsLoading] = useState(true)
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

  type PushFailEntry = { supplierId: string; supplierLabel: string; errors: string[] }
  const [lastPushFails, setLastPushFails] = useState<PushFailEntry[]>([])
  const [pushImagesLoading, setPushImagesLoading] = useState(false)
  const scanFileInputRef = useRef<HTMLInputElement>(null)
  const pushImageInputRef = useRef<HTMLInputElement>(null)

  const hasScanData = scanRows.length > 0
  const hasPushImages = pushImages.length > 0

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

  const supplierIdSet = useMemo(() => new Set(suppliers.map((s) => s.id)), [suppliers])
  const effectiveSelectedKeys = useMemo(
    () => selectedSupplierKeys.filter((id) => supplierIdSet.has(String(id))),
    [selectedSupplierKeys, supplierIdSet],
  )

  const hasTypedContentForPush = useMemo(() => {
    if (hasEditorContent(globalPushText)) return true
    const sel = new Set(effectiveSelectedKeys.map(String))
    return suppliers.some((s) => sel.has(s.id) && hasEditorContent(s.pushContent))
  }, [globalPushText, effectiveSelectedKeys, suppliers])

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

  const handleCommitted = async (values: FleetSupplierConfigDraft) => {
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

  const removeSupplier = async (row: FleetSupplierConfig) => {
    const res = await apiDeleteFleetSupplier(row.id)
    if (!res.ok) { showToast(`删除失败：${res.error}`, 'error'); return }
    setSuppliers((prev) => prev.filter((s) => s.id !== row.id))
    showToast(`已移除「${supplierDisplayName(row)}」。`, 'success')
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

  const pushCustomImageDataUrls = useMemo(() => pushImages.map((img) => img.dataUrl), [pushImages])

  const pushSupplierRichText = async (s: FleetSupplierConfig, editorHtml: string) => {
    const { content, images } = await prepareFleetRichPayload(editorHtml, [])
    return withRetry(() =>
      pushFleetRichMessage({
        pushScope: 'fleet-supplier',
        webhookUrl: s.webhookUrl,
        signingSecret: s.signingSecret,
        content,
        images,
      }),
    )
  }

  const pushSupplierSingleImage = async (s: FleetSupplierConfig, imageDataUrl: string) => {
    return withRetry(() =>
      pushFleetRichMessage({
        pushScope: 'fleet-supplier',
        webhookUrl: s.webhookUrl,
        signingSecret: s.signingSecret,
        content: '',
        images: [imageDataUrl],
      }),
    )
  }

  const pushForSupplier = async (
    s: FleetSupplierConfig,
    globalText: string,
    weatherLarkMd: string,
  ): Promise<string[]> => {
    const supplierErrors: string[] = []
    if (!s.webhookUrl.trim()) return ['未配置 webhook。']

    // 天气块置于推送内容末尾（供应商专属文案 + 顶栏推送内容之后）
    const mergedHtml = mergeEditorHtmlParts([s.pushContent.trim(), globalText, weatherLarkMd])
    const hasRichText = hasEditorContent(mergedHtml)
    const hasScan = scanRows.length > 0
    const hasManualImages = pushCustomImageDataUrls.length > 0

    if (!hasScan && !hasRichText && !hasManualImages) {
      return ['未填写可推送文案，也未添加推送图片。']
    }

    if (hasRichText) {
      const res = await pushSupplierRichText(s, mergedHtml)
      if (res.ok !== true) supplierErrors.push(`文案：${summarizeFeishuTestFailure(res)}`)
    }

    if (hasScan) {
      const routeCodes = parseFleetRouteCodes(s.routeCode)
      if (!routeCodes.length) {
        supplierErrors.push('未配置有效路由编码。')
      } else {
        const buckets = aggregateFleetRowsForRoute(scanRows, s.routeCode)
        const total = buckets.reduce((sum, b) => sum + b.total, 0)
        if (!total) {
          supplierErrors.push(`路由「${routeCodes.join('、')}」无匹配数据，已跳过货量截图。`)
        } else {
          try {
            const png = await captureFleetRouteReportPng({
              title: `${supplierDisplayName(s)} · 货量汇总`,
              subtitle: '',
              buckets,
            })
            const res = await pushSupplierSingleImage(s, png)
            if (res.ok !== true) supplierErrors.push(`货量截图：${summarizeFeishuTestFailure(res)}`)
          } catch (e) {
            supplierErrors.push(`货量截图：${e instanceof Error ? e.message : '截图失败'}`)
          }
        }
      }
    }

    for (let i = 0; i < pushCustomImageDataUrls.length; i++) {
      const res = await pushSupplierSingleImage(s, pushCustomImageDataUrls[i]!)
      if (res.ok !== true) {
        const label = pushCustomImageDataUrls.length > 1 ? `推送图片 ${i + 1}` : '推送图片'
        supplierErrors.push(`${label}：${summarizeFeishuTestFailure(res)}`)
      }
    }

    return supplierErrors
  }

  /** 若开启天气且选了城市，拉取一次 BOM 天气 lark_md；失败返回 '' 并提示，不阻断推送 */
  const resolveWeatherLarkMd = async (): Promise<string> => {
    if (!weatherEnabled) return ''
    const loc = WEATHER_LOCATION_PRESETS.find((l) => l.label === weatherCity)
    if (!loc) return ''
    const res = await fetchDeliveryWeatherLarkMd({ lat: loc.lat, lng: loc.lng, label: loc.label })
    if (!res.ok) {
      showToast(`天气预报获取失败，本次推送不含天气：${res.error}`, 'error')
      return ''
    }
    return res.larkMd
  }

  const runPushForTargets = async (
    targets: FleetSupplierConfig[],
    globalText: string,
    weatherLarkMd: string,
  ) => {
    const fails: PushFailEntry[] = []
    const oks: string[] = []
    for (const s of targets) {
      const errs = await pushForSupplier(s, globalText, weatherLarkMd)
      if (errs.length === 0) {
        oks.push(supplierDisplayName(s))
      } else {
        fails.push({ supplierId: s.id, supplierLabel: supplierDisplayName(s), errors: errs })
      }
    }
    setLastPushFails(fails)
    if (fails.length === 0) {
      showToast(`已向 ${oks.length} 家供应商完成推送。`, 'success')
    } else if (oks.length === 0) {
      showToast(`全部 ${fails.length} 家推送失败，请查看下方提示并重推。`, 'error')
    } else {
      showToast(`已推送 ${oks.length} 家，${fails.length} 家失败，请查看下方提示并重推。`, 'success')
    }
  }

  const handlePushAll = async () => {
    if (!canSend) { showToast('无操作权限', 'error'); return }
    if (scanParsing) return
    if (!suppliers.length) { showToast('请先添加至少一个供应商。', 'error'); return }

    const targets = suppliers.filter((s) => effectiveSelectedKeys.includes(s.id))
    if (!targets.length) { showToast('请至少勾选一家需要推送的供应商。', 'error'); return }

    const weatherOn = weatherEnabled && WEATHER_LOCATION_PRESETS.some((l) => l.label === weatherCity)
    const hasScan = scanRows.length > 0
    if (!hasScan && !hasPushImages && !weatherOn) {
      const canText = hasEditorContent(globalPushText) || targets.some((s) => hasEditorContent(s.pushContent))
      if (!canText) {
        showToast('未上传扫描文件时，请先填写「推送内容」、所选供应商的「供应商推送内容」，或添加推送图片。', 'error')
        return
      }
    }

    setPushing(true)
    setLastPushFails([])
    try {
      const weatherLarkMd = await resolveWeatherLarkMd()
      await runPushForTargets(targets, globalPushText, weatherLarkMd)
    } finally {
      setPushing(false)
    }
  }

  const handleRetryFailed = async () => {
    if (!canSend || pushing || !lastPushFails.length) return
    const failedIds = new Set(lastPushFails.map((f) => f.supplierId))
    const targets = suppliers.filter((s) => failedIds.has(s.id))
    if (!targets.length) return
    setPushing(true)
    setLastPushFails([])
    try {
      const weatherLarkMd = await resolveWeatherLarkMd()
      await runPushForTargets(targets, globalPushText, weatherLarkMd)
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
    if (!file) { showToast('请先选择文件。', 'error'); return }
    setImporting(true)
    try {
      const r = await parseFleetSuppliersImportFile(file)
      if (!r.ok) { showToast(r.error, 'error'); return }
      if (!importMerge) {
        const confirmed = await confirmDialog({
          title: '确认替换全部供应商配置？',
          content: `将删除当前 ${suppliers.length} 条配置，仅保留文件中的 ${r.suppliers.length} 条。`,
          okText: '替换',
          danger: true,
        })
        if (!confirmed) return
      }
      const res = await apiImportFleetSuppliers(importMerge ? 'merge' : 'replace', r.suppliers)
      if (!res.ok) { showToast(`导入失败：${res.error}`, 'error'); return }
      setSuppliers(res.data)
      closeImportModal()
      showToast(
        importMerge
          ? `已合并导入 ${r.suppliers.length} 条（相同 id 以文件为准）。`
          : `已导入并替换为 ${r.suppliers.length} 条供应商。`,
        'success',
      )
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
            <FeishuLarkMdEditor
              rows={4}
              value={globalPushText}
              onChange={setGlobalPushText}
              placeholder="与各供应商「供应商推送内容」合并为一条富文本推送（含段落与编辑器内图片）。货量截图与「选择推送图片」各单独一条消息。"
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
            <Tooltip title={!canSend ? '无操作权限' : undefined}>
              <Button
                type="primary"
                icon={<Send className="h-4 w-4" />}
                loading={pushing}
                disabled={
                  !canSend ||
                  scanParsing ||
                  !suppliers.length ||
                  effectiveSelectedKeys.length === 0 ||
                  (!hasScanData && !hasTypedContentForPush && !hasPushImages)
                }
                onClick={() => void handlePushAll()}
              >
                推送所选供应商
              </Button>
            </Tooltip>
            <div className="fs-toolbar-weather">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--admin-muted)]">
                <CloudRain className="h-3.5 w-3.5 text-[var(--admin-accent)]" aria-hidden />
                天气预报
              </span>
              <Switch
                checked={weatherEnabled}
                onChange={setWeatherEnabled}
                checkedChildren="开"
                unCheckedChildren="关"
              />
              <Select
                value={weatherCity || undefined}
                onChange={setWeatherCity}
                disabled={!weatherEnabled}
                placeholder="选择城市"
                className="!w-44"
                options={WEATHER_LOCATION_PRESETS.map((l) => ({ label: l.label, value: l.label }))}
              />
            </div>
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

          {lastPushFails.length > 0 && (
            <div className="fs-push-fail-panel">
              <div className="fs-push-fail-header">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{lastPushFails.length} 家推送失败</span>
                <Button
                  type="primary"
                  danger
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  loading={pushing}
                  onClick={() => void handleRetryFailed()}
                >
                  重推失败项
                </Button>
              </div>
              <ul className="fs-push-fail-list">
                {lastPushFails.map((f) => (
                  <li key={f.supplierId} className="fs-push-fail-item">
                    <span className="fs-push-fail-name">「{f.supplierLabel}」</span>
                    <span className="fs-push-fail-errors">{f.errors.join('；')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
            <Button type="dashed" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreate}>
              添加供应商
            </Button>
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
              loading={configsLoading}
              pagination={false}
              rowSelection={{
                selectedRowKeys: effectiveSelectedKeys,
                onChange: setSelectedSupplierKeys,
                columnWidth: 44,
                getCheckboxProps: (row) => ({
                  disabled: !row.webhookUrl.trim(),
                }),
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
            支持 xlsx、xls、csv、json。列名可与导出文件一致（英文字段），也可使用中文表头（如「供应商名称」「路由编码」等）。完整 webhook
            / 密钥请在「飞书推送」页导出或向东道主索取含密文的表格后再于此处导入。
          </p>
        </div>
      </Modal>
    </div>
  )
}
