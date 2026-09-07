import { useCallback, useRef, useState } from 'react'
import { loadFeishuPushStore } from '../PushNotifications/feishuPushRepository.idb'
import { feishuPushKindLabel } from '../PushNotifications/feishuPushTypes'
import {
  postFeishuPushImage,
  summarizeFeishuPushImageFailure,
} from '../PushNotifications/feishuWebhookTestApi'
import { captureScannerPushRegion, mergeImagesVertically } from './feishuLevel1ScreenshotCapture'
import { buildFeishuSortEfficiencyDataSnapshot } from './feishuSortEfficiencySnapshot'
import { dayjs } from './dayjsSetup'
import { upsertSortEfficiencyPushDaySnapshot } from './sortEfficiencyPushSnapshotRepository.idb'
import type { EfficiencyDetailDimension } from './DailyEfficiencyBubbleChart'
import type { ScannerEfficiencyViewModel } from './useScannerEfficiencyPage'
import { i18n } from '../../i18n/index'
import { showToast } from '../../utils/toast'

const level1PushErrorHint = () => String(i18n.t('push.errorHint', { ns: 'scannerEfficiency' }))

function pushErrorToast(text: string) {
  showToast(`${text} ${level1PushErrorHint()}`, 'error', 8)
}

// ── 可配置推送图表 ────────────────────────────────────────────────────
export type PushChartKey = 'attendance_table' | 'attendance_chart' | 'scanner_summary' | 'scanner_hourly'

export const PUSH_CHART_ALL_KEYS: PushChartKey[] = [
  'attendance_table',
  'attendance_chart',
  'scanner_summary',
  'scanner_hourly',
]

export function pushChartLabel(key: PushChartKey): string {
  return String(i18n.t(`push.chart.${key}`, { ns: 'scannerEfficiency' }))
}

export const PUSH_CHART_LABELS: Record<PushChartKey, string> = {
  get attendance_table() { return pushChartLabel('attendance_table') },
  get attendance_chart() { return pushChartLabel('attendance_chart') },
  get scanner_summary() { return pushChartLabel('scanner_summary') },
  get scanner_hourly() { return pushChartLabel('scanner_hourly') },
}

/** 需要 attendanceResult 才能捕获的图表 key */
const ATTENDANCE_KEYS = new Set<PushChartKey>(['attendance_table', 'attendance_chart'])

function efficiencyDetailDimensionLabel(dimension: EfficiencyDetailDimension): string {
  return dimension === 'week' ? String(i18n.t('dimension.week', { ns: 'scannerEfficiency' })) : String(i18n.t('dimension.day', { ns: 'scannerEfficiency' }))
}
/** 需要 scannerResult 才能捕获的图表 key */
const SCANNER_KEYS = new Set<PushChartKey>(['scanner_summary', 'scanner_hourly'])

/**
 * 选中后会合并成一张图推送的 key（效率明细/天 表+图、扫描员汇总）。
 * scanner_hourly 独立推送，不参与合并。
 */
const MERGEABLE_KEYS = new Set<PushChartKey>(['attendance_table', 'attendance_chart', 'scanner_summary'])

/** 返回当前数据下实际可用的图表 key 列表 */
export function getAvailableChartKeys(
  hasAttendance: boolean,
  hasScanner: boolean,
): PushChartKey[] {
  return PUSH_CHART_ALL_KEYS.filter((k) => {
    if (ATTENDANCE_KEYS.has(k)) return hasAttendance
    if (SCANNER_KEYS.has(k)) return hasScanner
    return true
  })
}

// ── 日期格式化 ────────────────────────────────────────────────────────
function formatSortingStatsDatePiece(d: string): string {
  const p = dayjs(d, ['YYYY-MM-DD', 'YYYY-M-D'], true)
  if (!p.isValid()) return d
  return String(
    i18n.t('push.dateFormat', {
      ns: 'scannerEfficiency',
      year: p.year(),
      month: p.month() + 1,
      day: p.date(),
    }),
  )
}

function formatSortingStatsDateBracketCn(dailyDates: readonly { date: string }[]): string {
  if (!dailyDates.length) {
    return formatSortingStatsDatePiece(dayjs().format('YYYY-MM-DD'))
  }
  const start = dailyDates[0].date
  const end = dailyDates[dailyDates.length - 1].date
  if (start === end) return formatSortingStatsDatePiece(start)
  return `${formatSortingStatsDatePiece(start)}${String(i18n.t('push.dateRangeSeparator', { ns: 'scannerEfficiency' }))}${formatSortingStatsDatePiece(end)}`
}

// ── Hook ──────────────────────────────────────────────────────────────
export function useScannerLevel1FeishuPush(
  vm: Pick<
    ScannerEfficiencyViewModel,
    | 'scannerResult'
    | 'scannerHourlyExpanded'
    | 'setScannerHourlyExpanded'
    | 'attendanceResult'
    | 'efficiencyDetailDimension'
    | 'dailyCostPerTicketByDate'
    | 'dailyTotalLaborCostByDate'
  >,
) {
  const {
    scannerResult,
    scannerHourlyExpanded,
    setScannerHourlyExpanded,
    attendanceResult,
    efficiencyDetailDimension,
    dailyCostPerTicketByDate,
    dailyTotalLaborCostByDate,
  } = vm

  // 四个独立捕获区域的 ref
  const attendanceTableCaptureRef = useRef<HTMLDivElement>(null)
  const attendanceChartCaptureRef = useRef<HTMLDivElement>(null)
  const scannerSummaryCaptureRef = useRef<HTMLDivElement>(null)
  const scannerHourlyCaptureRef = useRef<HTMLDivElement>(null)

  const [level1PushWorking, setLevel1PushWorking] = useState(false)
  // 默认全选
  const [selectedChartKeys, setSelectedChartKeys] = useState<PushChartKey[]>([...PUSH_CHART_ALL_KEYS])

  const pushLevel1EfficiencyScreenshots = useCallback(async () => {
    const store = await loadFeishuPushStore()
    const entries = store.sort_efficiency.filter((e) => e.webhookUrl.trim() && e.isDisabled !== true)
    if (!entries.length) {
      const kindLabel = feishuPushKindLabel('sort_efficiency')
      pushErrorToast(
        String(i18n.t('push.configureWebhook', { ns: 'scannerEfficiency', kind: kindLabel }))
      )
      return
    }

    if (!selectedChartKeys.length) {
      showToast(String(i18n.t('push.selectChart', { ns: 'scannerEfficiency' })), 'error')
      return
    }

    setLevel1PushWorking(true)
    const wasExpanded = scannerHourlyExpanded

    try {
      setScannerHourlyExpanded(true)
      await new Promise<void>((resolve) => setTimeout(resolve, 500))

      // 日期窗口与所选图表保持一致：选了考勤图则走考勤窗口；仅选扫描员图则走扫描口径窗口。
      const hasAttendanceChartSelected = selectedChartKeys.some((k) => ATTENDANCE_KEYS.has(k))
      const dateBracket =
        hasAttendanceChartSelected && attendanceResult
          ? formatSortingStatsDateBracketCn([
              { date: attendanceResult.summary.efficiencyRangeStart },
              { date: attendanceResult.summary.efficiencyRangeEnd },
            ])
          : scannerResult
            ? formatSortingStatsDateBracketCn(scannerResult.dailySummaryRows)
            : attendanceResult
              ? formatSortingStatsDateBracketCn([
                  { date: attendanceResult.summary.efficiencyRangeStart },
                  { date: attendanceResult.summary.efficiencyRangeEnd },
                ])
              : formatSortingStatsDateBracketCn([])

      const dataSnapshot = buildFeishuSortEfficiencyDataSnapshot({
        periodLabel: dateBracket,
        scannerResult,
        attendanceResult,
        attendanceDailyCostPerTicket: dailyCostPerTicketByDate,
        attendanceDailyTotalLaborCost: dailyTotalLaborCostByDate,
      })

      // 定义推送顺序及各图表的 headline 和是否携带 AI dataSnapshot
      const attendanceDimensionLabel = efficiencyDetailDimensionLabel(efficiencyDetailDimension)

      const allTargets: Array<{
        key: PushChartKey
        ref: React.RefObject<HTMLDivElement | null>
        headlineSuffix: string
        withDataSnapshot: boolean
      }> = [
        {
          key: 'attendance_table',
          ref: attendanceTableCaptureRef,
          headlineSuffix: String(i18n.t('push.headline.attendanceTable', { ns: 'scannerEfficiency', dimension: attendanceDimensionLabel })),
          withDataSnapshot: false,
        },
        {
          key: 'attendance_chart',
          ref: attendanceChartCaptureRef,
          headlineSuffix: String(i18n.t('push.headline.attendanceChart', { ns: 'scannerEfficiency', dimension: attendanceDimensionLabel })),
          withDataSnapshot: false,
        },
        {
          key: 'scanner_summary',
          ref: scannerSummaryCaptureRef,
          headlineSuffix: String(i18n.t('push.headline.scannerSummary', { ns: 'scannerEfficiency' })),
          withDataSnapshot: true,
        },
        {
          key: 'scanner_hourly',
          ref: scannerHourlyCaptureRef,
          headlineSuffix: String(i18n.t('push.headline.scannerHourly', { ns: 'scannerEfficiency' })),
          withDataSnapshot: false,
        },
      ]

      const toCapture = allTargets.filter(
        (t) => selectedChartKeys.includes(t.key) && t.ref.current,
      )

      if (!toCapture.length) {
        pushErrorToast(String(i18n.t('push.noRenderable', { ns: 'scannerEfficiency' })))
        return
      }

      // 逐个截图
      const capturedImages: Array<{
        target: (typeof allTargets)[number]
        img: string
      }> = []

      for (const target of toCapture) {
        try {
          const img = await captureScannerPushRegion(target.ref.current)
          capturedImages.push({ target, img })
        } catch (err) {
          const hint = err instanceof Error ? err.message : String(err)
          pushErrorToast(String(i18n.t('push.screenshotFailed', { ns: 'scannerEfficiency', chart: pushChartLabel(target.key), hint })))
          return
        }
      }

      // ── 区分"可合并"组与"独立"组 ───────────────────────────────────────
      const mergeableCaptures = capturedImages.filter((c) => MERGEABLE_KEYS.has(c.target.key))
      const separateCaptures = capturedImages.filter((c) => !MERGEABLE_KEYS.has(c.target.key))

      // 合并可合并组的图片（若只有 1 张则直接用，>1 张则垂直拼接）
      type PushTask = {
        img: string
        headlineText: string
        withDataSnapshot: boolean
        label: string
      }
      const pushTasks: PushTask[] = []

      if (mergeableCaptures.length > 0) {
        let mergedImg: string
        try {
          mergedImg = await mergeImagesVertically(mergeableCaptures.map((c) => c.img))
        } catch (err) {
          const hint = err instanceof Error ? err.message : String(err)
          pushErrorToast(String(i18n.t('push.mergeFailed', { ns: 'scannerEfficiency', hint })))
          return
        }
        const mergeableNames = mergeableCaptures.map((c) => PUSH_CHART_LABELS[c.target.key]).join(' + ')
        const hasSummary = mergeableCaptures.some((c) => c.target.key === 'scanner_summary')
        pushTasks.push({
          img: mergedImg,
          headlineText: String(
            i18n.t('push.headline.warehousePrefix', {
              ns: 'scannerEfficiency',
              date: dateBracket,
              suffix: mergeableNames,
            }),
          ),
          withDataSnapshot: hasSummary,
          label: mergeableNames,
        })
      }

      for (const { target, img } of separateCaptures) {
        pushTasks.push({
          img,
          headlineText: String(
            i18n.t('push.headline.warehousePrefix', {
              ns: 'scannerEfficiency',
              date: dateBracket,
              suffix: target.headlineSuffix,
            }),
          ),
          withDataSnapshot: target.withDataSnapshot,
          label: PUSH_CHART_LABELS[target.key],
        })
      }

      // 逐条 webhook × 逐个 pushTask 推送
      const warnings = new Set<string>()
      const errors: string[] = []

      for (const entry of entries) {
        const name = entry.pushName.trim() || String(i18n.t('push.unnamedPush', { ns: 'scannerEfficiency' }))
        for (const task of pushTasks) {
          const pushRes = await postFeishuPushImage({
            pushScope: 'warehouse-efficiency',
            webhookUrl: entry.webhookUrl,
            signingSecret: entry.signingSecret,
            imageBase64: task.img,
            headlineText: task.headlineText,
            ...(task.withDataSnapshot && dataSnapshot ? { dataSnapshot } : {}),
          })
          if (pushRes.ok === false) {
            errors.push(`「${name}·${task.label}」：${summarizeFeishuPushImageFailure(pushRes)}`)
          } else if (pushRes.aiAnalysisError && !pushRes.aiAnalysisGenerated) {
            warnings.add(pushRes.aiAnalysisError)
          }
        }
      }

      if (dataSnapshot && pushTasks.length > 0) {
        void upsertSortEfficiencyPushDaySnapshot(dataSnapshot)
      }

      const totalImgCount = pushTasks.length
      const chartNames = capturedImages.map((c) => PUSH_CHART_LABELS[c.target.key]).join('、')
      const kindLabel = feishuPushKindLabel('sort_efficiency')
      const base = String(i18n.t('push.successBase', { ns: 'scannerEfficiency', kind: kindLabel, count: entries.length, images: totalImgCount, charts: chartNames }))

      if (errors.length === 0) {
        showToast(
          warnings.size
            ? String(i18n.t('push.successWithWarnings', { ns: 'scannerEfficiency', base, warnings: [...warnings].join(' ') }))
            : base,
          'success',
          6,
        )
      } else if (errors.length >= entries.length * pushTasks.length) {
        pushErrorToast(errors.join(' '))
      } else {
        showToast(String(i18n.t('push.partialFailed', { ns: 'scannerEfficiency', errors: errors.join(' ') })), 'warning', 8)
      }
    } finally {
      if (!wasExpanded) {
        setScannerHourlyExpanded(false)
      }
      setLevel1PushWorking(false)
    }
  }, [
    attendanceResult,
    scannerHourlyExpanded,
    setScannerHourlyExpanded,
    scannerResult,
    selectedChartKeys,
    efficiencyDetailDimension,
    dailyCostPerTicketByDate,
    dailyTotalLaborCostByDate,
  ])

  return {
    attendanceTableCaptureRef,
    attendanceChartCaptureRef,
    scannerSummaryCaptureRef,
    scannerHourlyCaptureRef,
    level1PushWorking,
    selectedChartKeys,
    setSelectedChartKeys,
    pushLevel1EfficiencyScreenshots,
  }
}

export type ScannerLevel1FeishuPush = ReturnType<typeof useScannerLevel1FeishuPush>
