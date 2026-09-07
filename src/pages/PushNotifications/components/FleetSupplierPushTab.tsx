import { Button, Image, Input, Select, Switch, Tooltip } from 'antd'
import {
  AlertTriangle,
  CheckCheck,
  CloudRain,
  ExternalLink,
  FlipHorizontal2,
  Image as ImageIcon,
  RefreshCw,
  Search,
  Send,
  UploadCloud,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Key } from 'react'
import { useTranslation } from 'react-i18next'
import { aggregateFleetRowsForRoute } from '../fleetSupplierAggregate'
import { captureFleetRouteReportPng } from '../fleetReportCapture'
import { parseFleetRouteCodes } from '../fleetRouteCodeParse'
import { parseFleetScanFiles } from '../fleetScanParse'
import { fetchDeliveryWeatherLarkMd, fetchFeishuAppBotChats, summarizeFeishuTestFailure } from '../feishuWebhookTestApi'
import { WEATHER_LOCATION_PRESETS } from '../weatherLocations'
import { readWeatherPushSettings, writeWeatherPushSettings } from '../weatherPushSettings'
import {
  FeishuLarkMdEditor,
  hasEditorContent,
  mergeEditorHtmlParts,
  prepareFleetRichPayload,
} from '../../../components/FeishuLarkMdEditor'
import { pushFleetRichMessage } from '../pushFleetRichMessage'
import type { FleetSupplierConfig } from '../fleetSupplierPushTypes'
import { supplierDisplayName } from '../fleetSupplierPushTypes'
import { apiLoadFleetSuppliers } from '../fleetSupplierApi'
import { readLocalPushImage, type LocalPushImage } from '../pushImageLocal'
import { withRetry } from '../feishuPushRetry'
import { showToast } from '../../../utils/toast'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import {
  isSupplierPushEligible,
  SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH,
  SupplierMentionToggle,
} from '../../../shared/supplierPushConfig'
import { SupplierPushTargetPicker } from './SupplierPushTargetPicker'
import './fleetSupplierPushTab.css'

/**
 * 车队供应商推送：只读展示供应商配置并勾选本次推送对象。
 * 配置的新增/编辑/删除/导入导出统一在「系统管理 → 供应商配置」维护。
 */
export function FleetSupplierPushTab() {
  const { t } = useTranslation('pushNotifications')
  const canSend = usePermission(PERMISSION_KEYS.btnPushNotificationsFleetSupplier)
  const canMaintainConfig = usePermission(PERMISSION_KEYS.menuSupplierConfigs)
  const [globalPushText, setGlobalPushText] = useState('')
  // 天气预报开关与城市：从 localStorage 恢复，设置一次后长期保留
  const [weatherEnabled, setWeatherEnabled] = useState(() => readWeatherPushSettings().enabled)
  const [weatherCity, setWeatherCity] = useState(() => readWeatherPushSettings().city)
  const [mentionEnabled, setMentionEnabled] = useState(false)

  useEffect(() => {
    writeWeatherPushSettings({ enabled: weatherEnabled, city: weatherCity })
  }, [weatherEnabled, weatherCity])
  const [pushImages, setPushImages] = useState<LocalPushImage[]>([])
  const [suppliers, setSuppliers] = useState<FleetSupplierConfig[]>([])
  const [chatNameById, setChatNameById] = useState<Map<string, string>>(new Map())
  const [configsLoading, setConfigsLoading] = useState(true)
  const [selectedSupplierKeys, setSelectedSupplierKeys] = useState<Key[]>([])
  const [supplierKeyword, setSupplierKeyword] = useState('')

  const [scanRowCount, setScanRowCount] = useState(0)
  const [scanDropped, setScanDropped] = useState(0)
  const [scanFileLabel, setScanFileLabel] = useState('')
  const [scanRows, setScanRows] = useState<Awaited<ReturnType<typeof parseFleetScanFiles>>['rows']>([])

  const [pushing, setPushing] = useState(false)
  const [scanParsing, setScanParsing] = useState(false)

  type PushFailEntry = { supplierId: string; supplierLabel: string; errors: string[] }
  const [lastPushFails, setLastPushFails] = useState<PushFailEntry[]>([])
  const [pushImagesLoading, setPushImagesLoading] = useState(false)
  const scanFileInputRef = useRef<HTMLInputElement>(null)
  const pushImageInputRef = useRef<HTMLInputElement>(null)

  const listSep = t('common.listSeparator')
  const errorSep = t('fleetTab.errorSeparator')

  const hasScanData = scanRows.length > 0
  const hasPushImages = pushImages.length > 0

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setConfigsLoading(true)
      const res = await apiLoadFleetSuppliers()
      if (!cancelled) {
        if (res.ok) setSuppliers(res.data)
        else showToast(t('fleetTab.loadFailed', { error: res.error }), 'error')
        setConfigsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [t])

  useEffect(() => {
    let cancelled = false
    void fetchFeishuAppBotChats().then((res) => {
      if (cancelled || !res.ok) return
      setChatNameById(new Map(res.chats.map((c) => [c.chatId, c.name])))
    })
    return () => { cancelled = true }
  }, [])

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

  /** 供应商多时用关键字缩小勾选范围：昵称 / 供应商名 / 编码 / 路由 / 站点 / 飞书群名 */
  const filteredSuppliers = useMemo(() => {
    const kw = supplierKeyword.trim().toLowerCase()
    if (!kw) return suppliers
    return suppliers.filter((s) => {
      const chatName = s.chatId?.trim() ? chatNameById.get(s.chatId.trim()) ?? '' : ''
      return [s.supplierNickname, s.vendorName, s.vendorCode, s.routeCode, s.stationCode, chatName]
        .some((field) => (field ?? '').toLowerCase().includes(kw))
    })
  }, [suppliers, supplierKeyword, chatNameById])

  /** 当前筛选结果里可推送的供应商：全选 / 反选都只作用于这批，避免误勾到被搜索隐藏的行 */
  const eligibleFilteredIds = useMemo(
    () => filteredSuppliers.filter(isSupplierPushEligible).map((s) => s.id),
    [filteredSuppliers],
  )

  const selectedIdSet = useMemo(
    () => new Set(effectiveSelectedKeys.map(String)),
    [effectiveSelectedKeys],
  )

  const emptyText = useMemo(
    () =>
      supplierKeyword.trim()
        ? t('fleetTab.emptySearch', { keyword: supplierKeyword.trim() })
        : t('fleetTab.emptyList'),
    [supplierKeyword, t],
  )

  const toggleSupplierSelected = (configId: string) => {
    setSelectedSupplierKeys((prev) =>
      prev.includes(configId) ? prev.filter((id) => id !== configId) : [...prev, configId],
    )
  }

  const selectAllFiltered = () => {
    setSelectedSupplierKeys((prev) => Array.from(new Set([...prev.map(String), ...eligibleFilteredIds])))
  }

  const invertFiltered = () => {
    setSelectedSupplierKeys((prev) => {
      const next = new Set(prev.map(String))
      for (const id of eligibleFilteredIds) {
        if (next.has(id)) next.delete(id)
        else next.add(id)
      }
      return [...next]
    })
  }

  const allFilteredSelected =
    eligibleFilteredIds.length > 0 && eligibleFilteredIds.every((id) => selectedIdSet.has(id))

  const handleScanFiles = async (files: File[]) => {
    if (!files.length) return
    setScanParsing(true)
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    try {
      const parsed = await parseFleetScanFiles(files)
      if (!parsed.rows.length) {
        showToast(t('fleetTab.scanNoValidRows'), 'error')
        setScanRows([])
        setScanRowCount(0)
        setScanDropped(parsed.droppedRows)
        setScanFileLabel(parsed.fileNames.join(listSep))
        return
      }
      setScanRows(parsed.rows)
      setScanRowCount(parsed.rows.length)
      setScanDropped(parsed.droppedRows)
      setScanFileLabel(parsed.fileNames.join(listSep))
      showToast(
        t('fleetTab.scanReadSuccess', {
          fileCount: parsed.fileNames.length,
          rowCount: parsed.rows.length,
          dropped: parsed.droppedRows,
        }),
        'success',
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('fleetTab.parseFailed')
      showToast(t('fleetTab.scanParseFailed', { error: msg }), 'error')
      setScanRows([])
      setScanRowCount(0)
      setScanDropped(0)
      setScanFileLabel('')
    } finally {
      setScanParsing(false)
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
            errs.push(
              err instanceof Error ? err.message : t('fleetTab.fileReadFailed', { name: file.name }),
            )
          }
        }
        if (added.length) {
          setPushImages((prev) => [...prev, ...added])
        }
        if (errs.length === 1) {
          showToast(errs[0]!, 'error')
        } else if (errs.length > 1) {
          showToast(errs.join(errorSep), 'error')
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
        chatId: s.chatId,
        supplierConfigId: s.id,
        pushLabel: t('fleetTab.pushLabelSupplierContent'),
        content,
        images,
        mentionOpenIds: mentionEnabled ? s.mentionOpenIds.map((c) => c.openId).filter(Boolean) : undefined,
      }),
    )
  }

  const pushSupplierSingleImage = async (s: FleetSupplierConfig, imageDataUrl: string, pushLabel: string) => {
    return withRetry(() =>
      pushFleetRichMessage({
        pushScope: 'fleet-supplier',
        webhookUrl: s.webhookUrl,
        signingSecret: s.signingSecret,
        chatId: s.chatId,
        supplierConfigId: s.id,
        pushLabel,
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
    if (!s.webhookUrl.trim() && !s.chatId?.trim()) return [t('fleetTab.errorNoTarget')]

    // 天气块置于推送内容末尾（供应商专属文案 + 顶栏推送内容之后）
    const mergedHtml = mergeEditorHtmlParts([s.pushContent.trim(), globalText, weatherLarkMd])
    const hasRichText = hasEditorContent(mergedHtml)
    const hasScan = scanRows.length > 0
    const hasManualImages = pushCustomImageDataUrls.length > 0

    if (!hasScan && !hasRichText && !hasManualImages) {
      return [t('fleetTab.errorNoContent')]
    }

    if (hasRichText) {
      const res = await pushSupplierRichText(s, mergedHtml)
      if (res.ok !== true) {
        supplierErrors.push(`${t('fleetTab.errorCopyPrefix')}：${summarizeFeishuTestFailure(res)}`)
      }
    }

    if (hasScan) {
      const routeCodes = parseFleetRouteCodes(s.routeCode)
      if (!routeCodes.length) {
        supplierErrors.push(t('fleetTab.errorNoRouteCode'))
      } else {
        const buckets = aggregateFleetRowsForRoute(scanRows, s.routeCode)
        const total = buckets.reduce((sum, b) => sum + b.total, 0)
        if (!total) {
          supplierErrors.push(
            t('fleetTab.errorNoRouteData', { routes: routeCodes.join(listSep) }),
          )
        } else {
          try {
            const png = await captureFleetRouteReportPng({
              title: t('fleetTab.volumeSummaryTitle', { name: supplierDisplayName(s), lng: 'en' }),
              subtitle: '',
              buckets,
            })
            const res = await pushSupplierSingleImage(s, png, t('fleetTab.pushLabelImage'))
            if (res.ok !== true) {
              supplierErrors.push(
                `${t('fleetTab.errorVolumeScreenshotPrefix')}：${summarizeFeishuTestFailure(res)}`,
              )
            }
          } catch (e) {
            supplierErrors.push(
              `${t('fleetTab.errorVolumeScreenshotPrefix')}：${e instanceof Error ? e.message : t('fleetTab.screenshotFailed')}`,
            )
          }
        }
      }
    }

    for (let i = 0; i < pushCustomImageDataUrls.length; i++) {
      const label =
        pushCustomImageDataUrls.length > 1
          ? t('fleetTab.pushLabelImageN', { n: i + 1 })
          : t('fleetTab.pushLabelImage')
      const res = await pushSupplierSingleImage(s, pushCustomImageDataUrls[i]!, label)
      if (res.ok !== true) {
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
      showToast(t('fleetTab.weatherFetchFailed', { error: res.error }), 'error')
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
      showToast(t('fleetTab.pushAllSuccess', { count: oks.length }), 'success')
    } else if (oks.length === 0) {
      showToast(t('fleetTab.pushAllFailed', { count: fails.length }), 'error')
    } else {
      showToast(t('fleetTab.pushPartialSuccess', { ok: oks.length, fail: fails.length }), 'success')
    }
  }

  const handlePushAll = async () => {
    if (!canSend) { showToast(t('common.noPermission'), 'error'); return }
    if (scanParsing) return
    if (!suppliers.length) { showToast(t('fleetTab.addSupplierFirst'), 'error'); return }

    const targets = suppliers.filter((s) => effectiveSelectedKeys.includes(s.id))
    if (!targets.length) { showToast(t('fleetTab.selectSupplierFirst'), 'error'); return }

    const weatherOn = weatherEnabled && WEATHER_LOCATION_PRESETS.some((l) => l.label === weatherCity)
    const hasScan = scanRows.length > 0
    if (!hasScan && !hasPushImages && !weatherOn) {
      const canText = hasEditorContent(globalPushText) || targets.some((s) => hasEditorContent(s.pushContent))
      if (!canText) {
        showToast(t('fleetTab.contentRequiredWithoutScan'), 'error')
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

  const scanSkippedSuffix = scanDropped
    ? t('fleetTab.scanSkipped', { count: scanDropped })
    : ''

  return (
    <div className="fleet-supplier-push-tab space-y-5">
      <div className="fs-card">
        <div className="fs-card-head">
          <div>
            <div className="fs-card-head-title">{t('fleetTab.copyAndScanTitle')}</div>
          </div>
        </div>
        <div className="fs-card-body space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-[var(--admin-muted)]">{t('fleetTab.pushContent')}</div>
            <FeishuLarkMdEditor
              rows={4}
              value={globalPushText}
              onChange={setGlobalPushText}
              placeholder={t('fleetTab.pushContentPlaceholder')}
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
              {scanParsing ? t('fleetTab.parsingScan') : t('fleetTab.selectScanFiles')}
            </Button>
            <Button
              type="default"
              icon={<ImageIcon className="h-4 w-4" />}
              loading={pushImagesLoading}
              onClick={openPushImagePicker}
            >
              {pushImagesLoading ? t('fleetTab.readingImages') : t('fleetTab.selectPushImages')}
            </Button>
            <Tooltip title={!canSend ? t('common.noPermission') : undefined}>
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
                {t('fleetTab.pushSelected')}
              </Button>
            </Tooltip>
            <SupplierMentionToggle value={mentionEnabled} onChange={setMentionEnabled} />
            <div className="fs-toolbar-weather">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--admin-muted)]">
                <CloudRain className="h-3.5 w-3.5 text-[var(--admin-accent)]" aria-hidden />
                {t('fleetTab.weatherForecast')}
              </span>
              <Switch
                checked={weatherEnabled}
                onChange={setWeatherEnabled}
                checkedChildren={t('common.on')}
                unCheckedChildren={t('common.off')}
              />
              <Select
                value={weatherCity || undefined}
                onChange={setWeatherCity}
                disabled={!weatherEnabled}
                placeholder={t('fleetTab.selectCity')}
                className="!w-44"
                options={WEATHER_LOCATION_PRESETS.map((l) => ({ label: l.label, value: l.label }))}
              />
            </div>
            {scanParsing ? (
              <span className="text-xs text-[var(--admin-muted)]">{t('fleetTab.parsingTable')}</span>
            ) : null}
            {scanFileLabel ? (
              <div className="fs-file-pill">
                <span className="truncate">
                  {t('fleetTab.scanFileSummary', {
                    files: scanFileLabel,
                    rows: scanRowCount,
                    skipped: scanSkippedSuffix,
                  })}
                </span>
              </div>
            ) : null}
            {pushImages.length > 0 ? (
              <div className="fs-file-pill">
                <span>{t('fleetTab.pushImageCount', { count: pushImages.length })}</span>
              </div>
            ) : null}
          </div>

          {lastPushFails.length > 0 && (
            <div className="fs-push-fail-panel">
              <div className="fs-push-fail-header">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{t('fleetTab.pushFailedCount', { count: lastPushFails.length })}</span>
                <Button
                  type="primary"
                  danger
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  loading={pushing}
                  onClick={() => void handleRetryFailed()}
                >
                  {t('fleetTab.retryFailed')}
                </Button>
              </div>
              <ul className="fs-push-fail-list">
                {lastPushFails.map((f) => (
                  <li key={f.supplierId} className="fs-push-fail-item">
                    <span className="fs-push-fail-name">「{f.supplierLabel}」</span>
                    <span className="fs-push-fail-errors">{f.errors.join(errorSep)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pushImages.length > 0 ? (
            <Image.PreviewGroup>
              <ul className="fs-push-images" aria-label={t('fleetTab.pushImagesPreview')}>
                {pushImages.map((img) => (
                  <li key={img.id} className="fs-push-image-item">
                    <div className="fs-push-image-thumb-wrap">
                      <Image
                        src={img.dataUrl}
                        alt={img.name}
                        width={96}
                        height={96}
                        className="fs-push-image-thumb !rounded-md"
                        preview={{ mask: t('common.preview') }}
                      />
                      <button
                        type="button"
                        className="fs-push-image-remove"
                        aria-label={t('fleetTab.removeImage', { name: img.name })}
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
          <div>
            <div className="fs-card-head-title">{t('fleetTab.targetsTitle')}</div>
            <div className="fs-card-head-sub">{t('fleetTab.targetsSub')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={supplierKeyword}
              onChange={(e) => setSupplierKeyword(e.target.value)}
              allowClear
              prefix={<Search className="h-3.5 w-3.5 text-slate-400" aria-hidden />}
              placeholder={t('fleetTab.searchPlaceholder')}
              className="!w-64"
            />
            <Tooltip title={t('fleetTab.selectAllTooltip')}>
              <Button
                icon={<CheckCheck className="h-4 w-4" />}
                disabled={configsLoading || eligibleFilteredIds.length === 0 || allFilteredSelected}
                onClick={selectAllFiltered}
              >
                {t('fleetTab.selectAll')}
              </Button>
            </Tooltip>
            <Tooltip title={t('fleetTab.invertTooltip')}>
              <Button
                icon={<FlipHorizontal2 className="h-4 w-4" />}
                disabled={configsLoading || eligibleFilteredIds.length === 0}
                onClick={invertFiltered}
              >
                {t('fleetTab.invert')}
              </Button>
            </Tooltip>
            <span className="fs-badge-count">
              {t('fleetTab.selectedCount', {
                selected: effectiveSelectedKeys.length,
                total: suppliers.length,
              })}
            </span>
            {canMaintainConfig ? (
              <a
                className="inline-flex items-center gap-1 text-xs text-[var(--admin-accent)] hover:underline"
                href={SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH}
                target="_blank"
                rel="noreferrer"
                title={t('fleetTab.maintainConfigTooltip')}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t('fleetTab.maintainConfig')}
              </a>
            ) : null}
          </div>
        </div>
        <div className="fs-card-body !pt-3">
          <SupplierPushTargetPicker
            configs={filteredSuppliers}
            selectedIds={selectedIdSet}
            chatNameById={chatNameById}
            loading={configsLoading}
            onToggle={toggleSupplierSelected}
            emptyText={emptyText}
          />
        </div>
      </div>
    </div>
  )
}
