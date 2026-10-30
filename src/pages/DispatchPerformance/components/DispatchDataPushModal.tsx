import { useEffect, useMemo, useState } from 'react'
import { App, Alert, Button, Checkbox, Empty, Modal, Segmented, Tooltip } from 'antd'
import { Layers, ListChecks, Truck } from 'lucide-react'
import { toJpeg } from 'html-to-image'
import { useTranslation } from 'react-i18next'
import { FormSection } from '../../../components/FormSection'
import { loadSupplierPushCatalog } from '../../../shared/supplierPushConfig/catalogApi'
import type { SupplierPushConfig } from '../../../shared/supplierPushConfig/types'
import { FEISHU_PUSH_CAPTURE_PIXEL_RATIO, FEISHU_PUSH_JPEG_QUALITY } from '../../../utils/feishuScreenshotImageSettings'
import {
  postFeishuPushRichMessage,
  postFeishuPushRichMessageViaAppBot,
} from '../../PushNotifications/feishuWebhookTestApi'
import {
  rankDispatchSuppliers,
  type DispatchRankingMetricKey,
} from '../../../../shared/dispatchPerformance/rankingScore'
import { fetchDispatchPerformanceConfigs } from '../dispatchPerformanceApi'
import type { DispatchSupplierNode } from '../dispatchPerformanceTypes'
import { formatAvgTotal } from '../dispatchMetricThresholds'
import { DISPATCH_PUSH_METRIC_ALL_KEYS, dispatchPushMetricLabelKey, type DispatchPushMetricKey } from '../dispatchPushMetrics'
import { matchSupplierPushTargets } from '../dispatchPushTargets'
import { PUSH_MERGED_RANKING_SECTION_ID, pushSectionId } from '../dispatchPushCapture'
import { toDispatchRankingInput } from '../toDispatchRankingInput'
import { DispatchPushSupplierCard, StatusTag, type DispatchPushCardStatus } from './DispatchPushSupplierCard'
import { DispatchPushMergedRankingTable } from './DispatchPushMergedRankingTable'

type PushMode = 'individual' | 'merged'
type PushState = Record<string, { status: DispatchPushCardStatus; error?: string }>
type Translate = (key: string, options?: Record<string, unknown>) => string

function buildPushCaption(params: {
  stationName: string
  startDate: string
  endDate: string
  supplierName: string
}): string {
  return `**${params.stationName} 出仓派签达成分析**\n${params.startDate} ~ ${params.endDate}\n供应商：${params.supplierName}`
}

/** 合并排名推送模式下的文案：不点名单个供应商，因为这张图要发给多家群 */
function buildMergedPushCaption(params: { stationName: string; startDate: string; endDate: string }): string {
  return `**${params.stationName} 出仓派签达成分析 · 供应商综合排名**\n${params.startDate} ~ ${params.endDate}`
}

/** 把已经截好的一张图推给某供应商匹配到的全部目标（webhook/飞书群），两种推送模式共用这段 */
async function sendCapturedImageToTargets(params: {
  supplier: DispatchSupplierNode
  targets: SupplierPushConfig[]
  dataUrl: string
  content: string
  setPushState: (updater: (s: PushState) => PushState) => void
  t: Translate
}): Promise<'ok' | 'error'> {
  const { supplier, targets, dataUrl, content, setPushState, t } = params
  setPushState((s) => ({ ...s, [supplier.supplierKey]: { status: 'pushing' } }))
  const results = await Promise.all(
    targets.map((cfg) => {
      if (cfg.webhookUrl.trim()) {
        return postFeishuPushRichMessage({
          pushScope: 'dispatch-performance',
          webhookUrl: cfg.webhookUrl,
          signingSecret: cfg.signingSecret || undefined,
          content,
          images: [dataUrl],
        })
      }
      if (cfg.chatId.trim()) {
        return postFeishuPushRichMessageViaAppBot({
          pushScope: 'dispatch-performance',
          chatId: cfg.chatId,
          content,
          images: [dataUrl],
        })
      }
      return Promise.resolve({ ok: false as const, error: t('push.noChannel', { ns: 'dispatchPerformance' }) })
    }),
  )
  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) {
    setPushState((s) => ({ ...s, [supplier.supplierKey]: { status: 'ok' } }))
    return 'ok'
  }
  const errText = failed
    .map((r) => ('error' in r ? r.error : t('push.status.error', { ns: 'dispatchPerformance' })))
    .join('; ')
  setPushState((s) => ({ ...s, [supplier.supplierKey]: { status: 'error', error: errText } }))
  return 'error'
}

/** 「要推送的供应商」多选网格：样式与 SupplierPushSelectionGrid 保持一致，未配置推送目标的置灰不可勾 */
function SupplierPickGrid({
  suppliers,
  hasTargetMap,
  selectedKeys,
  onToggle,
  dayCount,
  t,
}: {
  suppliers: DispatchSupplierNode[]
  hasTargetMap: Map<string, boolean>
  selectedKeys: Set<string>
  onToggle: (supplierKey: string, next: boolean) => void
  dayCount: number
  t: Translate
}) {
  if (suppliers.length === 0) {
    return <p className="text-xs text-slate-400">{t('breakdown.empty', { ns: 'dispatchPerformance' })}</p>
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {suppliers.map((s) => {
        const eligible = hasTargetMap.get(s.supplierKey) ?? false
        const checked = selectedKeys.has(s.supplierKey)
        const checkboxNode = (
          <Checkbox
            checked={checked}
            disabled={!eligible}
            onChange={(e) => onToggle(s.supplierKey, e.target.checked)}
            className="flex w-full min-w-0 items-center [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:overflow-hidden"
          >
            <span className="flex min-w-0 flex-col leading-tight">
              <span className={`truncate text-[13px] font-semibold ${eligible ? 'text-slate-800' : 'text-slate-400'}`}>
                {s.supplierName}
              </span>
              <span className={`truncate text-[11px] font-mono ${eligible ? 'text-[var(--admin-accent)]' : 'text-slate-400'}`}>
                {s.vendorCode} · {formatAvgTotal(s.total, dayCount)}
              </span>
            </span>
          </Checkbox>
        )
        return (
          <label
            key={s.supplierKey}
            className={`flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-3 py-2.5 transition-colors ${
              !eligible
                ? 'cursor-default border-[var(--admin-line)] bg-[var(--admin-surface-soft)]'
                : checked
                  ? 'cursor-pointer border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]'
                  : 'cursor-pointer border-[var(--admin-line)] bg-white hover:bg-slate-50'
            }`}
          >
            {eligible ? (
              checkboxNode
            ) : (
              <Tooltip title={t('push.noTargetTooltip', { ns: 'dispatchPerformance' })}>
                <span className="flex w-full min-w-0">{checkboxNode}</span>
              </Tooltip>
            )}
          </label>
        )
      })}
    </div>
  )
}

export function DispatchDataPushModal({
  open,
  onClose,
  configId,
  stationName,
  startDate,
  endDate,
  suppliers,
  dayCount,
  rankingWeights,
}: {
  open: boolean
  onClose: () => void
  configId: string
  stationName: string
  startDate: string
  endDate: string
  suppliers: DispatchSupplierNode[]
  dayCount: number
  /** 「供应商综合排名」当前生效的权重（页面上调整过就带调整后的），推送预览用同一份口径 */
  rankingWeights: Record<DispatchRankingMetricKey, number>
}) {
  const { t } = useTranslation(['dispatchPerformance', 'common'])
  const { message } = App.useApp()

  const [catalog, setCatalog] = useState<SupplierPushConfig[]>([])
  const [pushConfigIds, setPushConfigIds] = useState<string[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const [pushMode, setPushMode] = useState<PushMode>('individual')
  const [selectedMetricKeys, setSelectedMetricKeys] = useState<DispatchPushMetricKey[]>(DISPATCH_PUSH_METRIC_ALL_KEYS)
  const [selectedSupplierKeys, setSelectedSupplierKeys] = useState<string[]>([])
  const [pushState, setPushState] = useState<PushState>({})
  const [pushing, setPushing] = useState(false)

  /** 只有本区间内实际出过单的供应商才值得进选择/预览列表 */
  const pushableSuppliers = useMemo(() => suppliers.filter((s) => s.total > 0), [suppliers])

  const hasTargetMap = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const s of pushableSuppliers) {
      map.set(s.supplierKey, matchSupplierPushTargets(s.vendorCode, pushConfigIds, catalog).length > 0)
    }
    return map
  }, [pushableSuppliers, pushConfigIds, catalog])

  /** 与 SupplierRankingBoard 同一份权重、同一套算法算出来的排名，推送图片里显示的分数/名次不能跟页面上对不上 */
  const rankingPool = useMemo(
    () => rankDispatchSuppliers(suppliers.map(toDispatchRankingInput), rankingWeights),
    [suppliers, rankingWeights],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setCatalogLoading(true)
    setCatalogError(null)
    setPushMode('individual')
    setSelectedMetricKeys(DISPATCH_PUSH_METRIC_ALL_KEYS)
    setSelectedSupplierKeys([])
    setPushState({})
    void Promise.all([loadSupplierPushCatalog(), fetchDispatchPerformanceConfigs()])
      .then(([catalogRes, configs]) => {
        if (cancelled) return
        if (!catalogRes.ok) {
          setCatalogError(catalogRes.error)
          return
        }
        const resolvedPushConfigIds = configs.find((c) => c.id === configId)?.pushConfigIds ?? []
        setCatalog(catalogRes.data)
        setPushConfigIds(resolvedPushConfigIds)
        // 默认只勾选「有数据 + 已配置推送目标」的供应商，未配置目标的留给用户自己看到、去补配置
        const defaultKeys = suppliers
          .filter(
            (s) =>
              s.total > 0 &&
              matchSupplierPushTargets(s.vendorCode, resolvedPushConfigIds, catalogRes.data).length > 0,
          )
          .map((s) => s.supplierKey)
        setSelectedSupplierKeys(defaultKeys)
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalogError(err instanceof Error ? err.message : t('push.loadCatalogError', { ns: 'dispatchPerformance' }))
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- suppliers 只用于算一次默认勾选，不必作为依赖重新拉取目录
  }, [open, configId, t])

  const selectedSupplierKeySet = useMemo(() => new Set(selectedSupplierKeys), [selectedSupplierKeys])
  const previewSuppliers = useMemo(
    () => pushableSuppliers.filter((s) => selectedSupplierKeySet.has(s.supplierKey)),
    [pushableSuppliers, selectedSupplierKeySet],
  )

  const eligibleSupplierKeys = useMemo(
    () => pushableSuppliers.filter((s) => hasTargetMap.get(s.supplierKey)).map((s) => s.supplierKey),
    [pushableSuppliers, hasTargetMap],
  )
  const allEligibleSupplierSelected =
    eligibleSupplierKeys.length > 0 && eligibleSupplierKeys.every((key) => selectedSupplierKeySet.has(key))

  const handlePush = async () => {
    if (pushing) return
    setPushing(true)
    let okCount = 0
    let errCount = 0
    let skipCount = 0

    if (pushMode === 'merged') {
      // 合并模式：只截一次图，同一张图依次发给本次勾选的每个供应商各自匹配到的目标
      const el = document.getElementById(PUSH_MERGED_RANKING_SECTION_ID)
      let dataUrl: string | undefined
      let captureError: string | undefined
      if (!el) {
        captureError = t('push.sectionNotFound', { ns: 'dispatchPerformance' })
      } else {
        try {
          dataUrl = await toJpeg(el, {
            pixelRatio: FEISHU_PUSH_CAPTURE_PIXEL_RATIO,
            quality: FEISHU_PUSH_JPEG_QUALITY,
            backgroundColor: '#ffffff',
          })
        } catch (err) {
          captureError = err instanceof Error ? err.message : t('push.captureFailed', { ns: 'dispatchPerformance' })
        }
      }

      if (!dataUrl) {
        for (const supplier of previewSuppliers) {
          setPushState((s) => ({ ...s, [supplier.supplierKey]: { status: 'error', error: captureError } }))
        }
        errCount += previewSuppliers.length
      } else {
        const content = buildMergedPushCaption({ stationName, startDate, endDate })
        for (const supplier of previewSuppliers) {
          const targets = matchSupplierPushTargets(supplier.vendorCode, pushConfigIds, catalog)
          if (targets.length === 0) {
            setPushState((s) => ({ ...s, [supplier.supplierKey]: { status: 'skipped' } }))
            skipCount += 1
            continue
          }
          const result = await sendCapturedImageToTargets({ supplier, targets, dataUrl, content, setPushState, t })
          if (result === 'ok') okCount += 1
          else errCount += 1
        }
      }
    } else {
      for (const supplier of previewSuppliers) {
        const targets = matchSupplierPushTargets(supplier.vendorCode, pushConfigIds, catalog)
        if (targets.length === 0) {
          setPushState((s) => ({ ...s, [supplier.supplierKey]: { status: 'skipped' } }))
          skipCount += 1
          continue
        }

        setPushState((s) => ({ ...s, [supplier.supplierKey]: { status: 'capturing' } }))
        const el = document.getElementById(pushSectionId(supplier.supplierKey))
        if (!el) {
          setPushState((s) => ({
            ...s,
            [supplier.supplierKey]: {
              status: 'error',
              error: t('push.sectionNotFound', { ns: 'dispatchPerformance' }),
            },
          }))
          errCount += 1
          continue
        }

        let dataUrl: string
        try {
          dataUrl = await toJpeg(el, {
            pixelRatio: FEISHU_PUSH_CAPTURE_PIXEL_RATIO,
            quality: FEISHU_PUSH_JPEG_QUALITY,
            backgroundColor: '#ffffff',
          })
        } catch (err) {
          setPushState((s) => ({
            ...s,
            [supplier.supplierKey]: {
              status: 'error',
              error: err instanceof Error ? err.message : t('push.captureFailed', { ns: 'dispatchPerformance' }),
            },
          }))
          errCount += 1
          continue
        }

        const content = buildPushCaption({ stationName, startDate, endDate, supplierName: supplier.supplierName })
        const result = await sendCapturedImageToTargets({ supplier, targets, dataUrl, content, setPushState, t })
        if (result === 'ok') okCount += 1
        else errCount += 1
      }
    }

    setPushing(false)
    const summary = t('push.summary', { ok: okCount, err: errCount, skip: skipCount, ns: 'dispatchPerformance' })
    if (errCount > 0) void message.warning(summary)
    else void message.success(summary)
  }

  const pushDisabled =
    pushing || catalogLoading || !selectedMetricKeys.length || !selectedSupplierKeys.length

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('push.modalTitle', { ns: 'dispatchPerformance' })}
      destroyOnHidden
      width={960}
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose}>{t('close', { ns: 'common' })}</Button>
        </div>
      }
    >
      <div className="space-y-3 pt-2">
        {catalogError ? <Alert type="error" showIcon message={catalogError} /> : null}

        <FormSection
          icon={Layers}
          title={t('push.modeSectionTitle', { ns: 'dispatchPerformance' })}
          description={t('push.modeSectionDesc', { ns: 'dispatchPerformance' })}
        >
          <Segmented
            value={pushMode}
            onChange={(value) => setPushMode(value as PushMode)}
            disabled={pushing}
            options={[
              { label: t('push.mode.individualLabel', { ns: 'dispatchPerformance' }), value: 'individual' },
              { label: t('push.mode.mergedLabel', { ns: 'dispatchPerformance' }), value: 'merged' },
            ]}
          />
        </FormSection>

        <FormSection
          icon={ListChecks}
          title={t('push.metricsSectionTitle', { ns: 'dispatchPerformance' })}
          description={t('push.metricsSectionDesc', { ns: 'dispatchPerformance' })}
        >
          <Checkbox.Group
            value={selectedMetricKeys}
            onChange={(keys) => setSelectedMetricKeys(keys as DispatchPushMetricKey[])}
            disabled={pushing}
            options={DISPATCH_PUSH_METRIC_ALL_KEYS.map((key) => ({
              value: key,
              label: t(dispatchPushMetricLabelKey(key), { ns: 'dispatchPerformance' }),
            }))}
            className="flex flex-wrap gap-x-4 gap-y-2"
          />
        </FormSection>

        <FormSection
          icon={Truck}
          title={t('push.supplierSectionTitle', { ns: 'dispatchPerformance' })}
          description={t(
            pushMode === 'merged' ? 'push.supplierSectionDescMerged' : 'push.supplierSectionDesc',
            { ns: 'dispatchPerformance' },
          )}
          action={
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setSelectedSupplierKeys(eligibleSupplierKeys)}
                disabled={pushing || catalogLoading || allEligibleSupplierSelected || eligibleSupplierKeys.length === 0}
              >
                {t('selectAll', { ns: 'common' })}
              </Button>
              <Button
                onClick={() => setSelectedSupplierKeys([])}
                disabled={pushing || catalogLoading || selectedSupplierKeys.length === 0}
              >
                {t('clearAll', { ns: 'common' })}
              </Button>
            </div>
          }
        >
          <SupplierPickGrid
            suppliers={pushableSuppliers}
            hasTargetMap={hasTargetMap}
            selectedKeys={selectedSupplierKeySet}
            onToggle={(key, next) =>
              setSelectedSupplierKeys((prev) => (next ? [...prev, key] : prev.filter((k) => k !== key)))
            }
            dayCount={dayCount}
            t={t}
          />
        </FormSection>

        <div className="flex justify-end">
          <Button type="primary" loading={pushing} disabled={pushDisabled} onClick={() => void handlePush()}>
            {t('push.confirmButton', { ns: 'dispatchPerformance' })}
          </Button>
        </div>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          {pushMode === 'merged' ? (
            <>
              <DispatchPushMergedRankingTable
                suppliers={pushableSuppliers}
                rankingPool={rankingPool}
                metricKeys={selectedMetricKeys}
                dayCount={dayCount}
                weights={rankingWeights}
              />
              {previewSuppliers.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('breakdown.empty', { ns: 'dispatchPerformance' })}
                />
              ) : (
                <div className="space-y-1.5">
                  {previewSuppliers.map((supplier) => (
                    <div
                      key={supplier.supplierKey}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[var(--admin-line)] bg-white px-3 py-2"
                    >
                      <span className="truncate text-sm text-slate-700">
                        {supplier.supplierName}
                        <span className="ml-1.5 font-mono text-xs text-slate-400">{supplier.vendorCode}</span>
                      </span>
                      {!hasTargetMap.get(supplier.supplierKey) ? (
                        <StatusTag status="skipped" t={t} />
                      ) : (
                        <StatusTag
                          status={pushState[supplier.supplierKey]?.status}
                          error={pushState[supplier.supplierKey]?.error}
                          t={t}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : previewSuppliers.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('breakdown.empty', { ns: 'dispatchPerformance' })} />
          ) : (
            previewSuppliers.map((supplier) => (
              <DispatchPushSupplierCard
                key={supplier.supplierKey}
                supplier={supplier}
                metricKeys={selectedMetricKeys}
                dayCount={dayCount}
                hasTarget={hasTargetMap.get(supplier.supplierKey) ?? false}
                ranking={rankingPool.poolSize >= 2 ? rankingPool.byKey.get(supplier.supplierKey) : undefined}
                status={pushState[supplier.supplierKey]?.status}
                error={pushState[supplier.supplierKey]?.error}
              />
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
