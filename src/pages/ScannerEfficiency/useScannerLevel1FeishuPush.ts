import { useCallback, useRef, useState } from 'react'
import { loadFeishuPushStore } from '../PushNotifications/feishuPushRepository.idb'
import { FEISHU_PUSH_KIND_LABELS } from '../PushNotifications/feishuPushTypes'
import {
  postFeishuPushImage,
  summarizeFeishuPushImageFailure,
} from '../PushNotifications/feishuWebhookTestApi'
import { captureScannerPushRegion, mergeImagesVertically } from './feishuLevel1ScreenshotCapture'
import { buildFeishuSortEfficiencyDataSnapshot } from './feishuSortEfficiencySnapshot'
import { dayjs } from './dayjsSetup'
import { upsertSortEfficiencyPushDaySnapshot } from './sortEfficiencyPushSnapshotRepository.idb'
import type { ScannerEfficiencyViewModel } from './useScannerEfficiencyPage'
import { showToast } from '../../utils/toast'

const LEVEL1_PUSH_ERROR_HINT =
  '可到「推送通知 → 一级分拣效率推送」维护 webhook；若上载失败请在后端 .env 核对 FEISHU_APP_ID 与 FEISHU_APP_SECRET。'

function pushErrorToast(text: string) {
  showToast(`${text} ${LEVEL1_PUSH_ERROR_HINT}`, 'error', 8)
}

// ── 可配置推送图表 ────────────────────────────────────────────────────
export type PushChartKey = 'attendance_table' | 'attendance_chart' | 'scanner_summary' | 'scanner_hourly'

export const PUSH_CHART_ALL_KEYS: PushChartKey[] = [
  'attendance_table',
  'attendance_chart',
  'scanner_summary',
  'scanner_hourly',
]

export const PUSH_CHART_LABELS: Record<PushChartKey, string> = {
  attendance_table: '效率明细/天（表）',
  attendance_chart: '效率明细/天（图）',
  scanner_summary: '扫描员汇总',
  scanner_hourly: '按小时段',
}

/** 需要 attendanceResult 才能捕获的图表 key */
const ATTENDANCE_KEYS = new Set<PushChartKey>(['attendance_table', 'attendance_chart'])
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
function formatSortingStatsDateBracketCn(dailyDates: readonly { date: string }[]): string {
  if (!dailyDates.length) {
    const n = dayjs()
    return `${n.year()}年${n.month() + 1}月${n.date()}日`
  }
  const start = dailyDates[0].date
  const end = dailyDates[dailyDates.length - 1].date
  const piece = (d: string): string => {
    const p = dayjs(d, ['YYYY-MM-DD', 'YYYY-M-D'], true)
    return p.isValid() ? `${p.year()}年${p.month() + 1}月${p.date()}日` : d
  }
  if (start === end) return piece(start)
  return `${piece(start)}～${piece(end)}`
}

// ── Hook ──────────────────────────────────────────────────────────────
export function useScannerLevel1FeishuPush(
  vm: Pick<
    ScannerEfficiencyViewModel,
    | 'scannerResult'
    | 'scannerHourlyExpanded'
    | 'setScannerHourlyExpanded'
    | 'attendanceResult'
  >,
) {
  const { scannerResult, scannerHourlyExpanded, setScannerHourlyExpanded, attendanceResult } = vm

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
      const kindLabel = FEISHU_PUSH_KIND_LABELS.sort_efficiency
      pushErrorToast(
        `请先前往「推送通知」页面配置并启用「${kindLabel}」，至少保留一条可用的群 webhook。`
      )
      return
    }

    if (!selectedChartKeys.length) {
      showToast('请至少选择一个要推送的图表。', 'error')
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
      })

      // 定义推送顺序及各图表的 headline 和是否携带 AI dataSnapshot
      const allTargets: Array<{
        key: PushChartKey
        ref: React.RefObject<HTMLDivElement | null>
        headlineSuffix: string
        withDataSnapshot: boolean
      }> = [
        {
          key: 'attendance_table',
          ref: attendanceTableCaptureRef,
          headlineSuffix: '效率明细/天（表格）',
          withDataSnapshot: false,
        },
        {
          key: 'attendance_chart',
          ref: attendanceChartCaptureRef,
          headlineSuffix: '效率明细/天（组合图）',
          withDataSnapshot: false,
        },
        {
          key: 'scanner_summary',
          ref: scannerSummaryCaptureRef,
          headlineSuffix: '一级分拣效率（百字简报 + 汇总图）',
          withDataSnapshot: true,
        },
        {
          key: 'scanner_hourly',
          ref: scannerHourlyCaptureRef,
          headlineSuffix: '按小时段分布',
          withDataSnapshot: false,
        },
      ]

      const toCapture = allTargets.filter(
        (t) => selectedChartKeys.includes(t.key) && t.ref.current,
      )

      if (!toCapture.length) {
        pushErrorToast('选中的图表当前均无数据或未渲染，请确认数据已载入。')
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
          pushErrorToast(`截图失败（${PUSH_CHART_LABELS[target.key]}）：${hint}`)
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
          pushErrorToast(`图片合并失败：${hint}`)
          return
        }
        const mergeableNames = mergeableCaptures.map((c) => PUSH_CHART_LABELS[c.target.key]).join(' + ')
        const hasSummary = mergeableCaptures.some((c) => c.target.key === 'scanner_summary')
        pushTasks.push({
          img: mergedImg,
          headlineText: `[仓库管理]【${dateBracket}】${mergeableNames}`,
          withDataSnapshot: hasSummary,
          label: mergeableNames,
        })
      }

      // 按小时段独立推送
      for (const { target, img } of separateCaptures) {
        pushTasks.push({
          img,
          headlineText: `[仓库管理]【${dateBracket}】${target.headlineSuffix}`,
          withDataSnapshot: target.withDataSnapshot,
          label: PUSH_CHART_LABELS[target.key],
        })
      }

      // 逐条 webhook × 逐个 pushTask 推送
      const warnings = new Set<string>()
      const errors: string[] = []

      for (const entry of entries) {
        const name = entry.pushName.trim() || '未命名推送'
        for (const task of pushTasks) {
          const pushRes = await postFeishuPushImage({
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
      const kindLabel = FEISHU_PUSH_KIND_LABELS.sort_efficiency
      const base = `已向「${kindLabel}」配置的 ${entries.length} 条机器人各推送：${totalImgCount} 张图（${chartNames}）。`

      if (errors.length === 0) {
        showToast(
          warnings.size ? `${base} 提示：${[...warnings].join(' ')}` : base,
          'success',
          6
        )
      } else if (errors.length >= entries.length * pushTasks.length) {
        pushErrorToast(errors.join(' '))
      } else {
        showToast(`部分失败：${errors.join(' ')}`, 'warning', 8)
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
