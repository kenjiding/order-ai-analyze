import { Button, DatePicker, Tooltip, Typography } from 'antd'
import { Save, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import {
  buildManualAttendanceSchedulingPlanPreview,
  flattenPreviewCellTexts,
  resolveAttendanceSchedulingPlanTitle,
  syncPlanTitleForDateChange,
} from '../../ScannerEfficiency/attendanceSchedulingPlanPreviewModel'
import AttendanceSchedulingPlanPreviewView from '../../ScannerEfficiency/components/AttendanceSchedulingPlanPreview'
import { applyAttendanceSchedulingPlanCellChange, recalculateEfficiencyAchievementRatios } from '../../ScannerEfficiency/attendanceSchedulingPlanCellUpdates'
import { dayjs } from '../../ScannerEfficiency/dayjsSetup'
import { SKIP_FEISHU_CAPTURE_ATTR } from '../../ScannerEfficiency/feishuLevel1ScreenshotCapture'
import { useAttendanceSchedulingFeishuPush } from '../../ScannerEfficiency/useAttendanceSchedulingFeishuPush'
import {
  applyPlanDatePrefixToCellTexts,
  mergeCellTextsNonEmpty,
  mergeCellTextsWithBase,
  remapCellTextsToPlanDate,
  stripPlanDatePrefixFromCellTexts,
  type AttendanceSchedulingPushTemplate,
} from '../attendanceSchedulingPushTemplateStorage'
import {
  loadAttendanceSchedulingPushTemplate,
  persistAttendanceSchedulingPushTemplate,
} from '../attendanceSchedulingPushTemplateRepository.idb'
import {
  buildSection2AutoFill,
  loadMostRecentDaySnapshot,
  saveDaySnapshot,
} from '../attendanceSchedulingDaySnapshot'
import { showToast } from '../../../utils/toast'

// 切换日期时去掉旧日期带过来的 Section 2 数据（S2 内容与日期强绑定，不应跟随迁移）
function stripSection2Cells(cellTexts: Record<string, string>, planDate: string): Record<string, string> {
  const s2Prefix = `${planDate}:s2-`
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(cellTexts)) {
    if (!key.startsWith(s2Prefix)) out[key] = value
  }
  return out
}

function defaultPlanDate(): string {
  return dayjs().format('YYYY-MM-DD')
}

export function AttendanceSchedulingPushPanel() {
  const { t } = useTranslation('pushNotifications')
  const canSend = usePermission(PERMISSION_KEYS.btnPushNotificationsAttendanceScheduling)
  const { pushing, setPreviewCaptureRef, pushSchedulingPlanPreviews } = useAttendanceSchedulingFeishuPush()
  const [planDate, setPlanDate] = useState(defaultPlanDate)
  const [cellTexts, setCellTexts] = useState<Record<string, string>>({})
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)

  const templateRef = useRef<AttendanceSchedulingPushTemplate | null>(null)
  const prevPlanDateRef = useRef(planDate)
  const initializedRef = useRef(false)

  const preview = useMemo(
    () => buildManualAttendanceSchedulingPlanPreview({ planDate }),
    [planDate],
  )

  const previewForPush = useMemo(
    () => ({
      ...preview,
      title: resolveAttendanceSchedulingPlanTitle(preview, cellTexts),
    }),
    [cellTexts, preview],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const template = await loadAttendanceSchedulingPushTemplate()
      if (cancelled) return
      templateRef.current = template
      if (template?.planDate) {
        const today = dayjs().format('YYYY-MM-DD')
        if (template.planDate >= today) {
          // 模板日期是今天或未来：原样恢复
          setPlanDate(template.planDate)
          prevPlanDateRef.current = template.planDate
        } else {
          // 模板日期是过去（跨天场景）：保持今天为 planDate，
          // Section 4 数据仍从模板读取，Section 2 由昨天快照回填
          // prevPlanDateRef 不动（仍为初始的 today），init 时直接用 today 前缀
        }
      }
      setTemplateLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!templateLoaded) return

    const base = flattenPreviewCellTexts(preview)
    const recentSnap = loadMostRecentDaySnapshot(planDate)
    const s2AutoFill = recentSnap ? buildSection2AutoFill(planDate, recentSnap.cells) : {}

    if (!initializedRef.current) {
      initializedRef.current = true
      const template = templateRef.current
      const overlay = template?.cells ? applyPlanDatePrefixToCellTexts(template.cells, planDate) : {}
      // 优先级：base < s2AutoFill < overlay（非空值才覆盖，防止模板空值清掉自动回填）
      const merged = mergeCellTextsNonEmpty(mergeCellTextsWithBase(base, s2AutoFill), overlay)
      setCellTexts(recalculateEfficiencyAchievementRatios(merged))
      prevPlanDateRef.current = planDate
      return
    }

    if (prevPlanDateRef.current !== planDate) {
      setCellTexts((prev) => {
        const remapped = remapCellTextsToPlanDate(prev, prevPlanDateRef.current, planDate)
        // 切换日期时，去掉旧日期带来的 S2 数据，改为从前一天快照回填
        const withoutOldS2 = stripSection2Cells(remapped, planDate)
        const withTitle = syncPlanTitleForDateChange(withoutOldS2, prevPlanDateRef.current, planDate)
        // 优先级：base < s2AutoFill < withTitle（用户填写的非S2数据）
        const merged = mergeCellTextsWithBase(mergeCellTextsWithBase(base, s2AutoFill), withTitle)
        return recalculateEfficiencyAchievementRatios(merged)
      })
      prevPlanDateRef.current = planDate
    }
  }, [planDate, preview, templateLoaded])

  const handleCellChange = (key: string, text: string) => {
    setCellTexts((prev) => applyAttendanceSchedulingPlanCellChange(prev, key, text))
  }

  const handleSaveTemplate = useCallback(async () => {
    setSavingTemplate(true)
    try {
      const stripped = stripPlanDatePrefixFromCellTexts(cellTexts, planDate)
      const template: AttendanceSchedulingPushTemplate = { planDate, cells: stripped }
      await persistAttendanceSchedulingPushTemplate(template)
      templateRef.current = template
      saveDaySnapshot(planDate, stripped)
      showToast(t('attendanceTab.templateSaved'), 'success')
    } catch {
      showToast(t('attendanceTab.templateSaveFailed'), 'error')
    } finally {
      setSavingTemplate(false)
    }
  }, [cellTexts, planDate, t])

  return (
    <div className="attendance-scheduling-push-tab space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--admin-line)] bg-gradient-to-br from-[var(--admin-sky-soft)] via-[var(--admin-surface-soft)] to-[var(--admin-accent-soft)] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Typography.Text type="secondary" className="text-xs">
              {t('attendanceTab.planDate')}
            </Typography.Text>
            <DatePicker
              value={dayjs(planDate)}
              allowClear={false}
              onChange={(value) => {
                if (!value) return
                setPlanDate(value.format('YYYY-MM-DD'))
              }}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" {...{ [SKIP_FEISHU_CAPTURE_ATTR]: '' }}>
          <Button
            icon={<Save className="h-4 w-4" />}
            loading={savingTemplate}
            disabled={!templateLoaded || savingTemplate || pushing}
            onClick={() => void handleSaveTemplate()}
          >
            {t('attendanceTab.saveTemplate')}
          </Button>
          <Tooltip title={!canSend ? t('common.noPermission') : undefined}>
            <Button
              type="primary"
              icon={<Send className="h-4 w-4" />}
              loading={pushing}
              disabled={!canSend || !templateLoaded || pushing}
              onClick={() => {
                if (!canSend) {
                  showToast(t('common.noPermission'), 'error')
                  return
                }
                saveDaySnapshot(planDate, stripPlanDatePrefixFromCellTexts(cellTexts, planDate))
                void pushSchedulingPlanPreviews([previewForPush])
              }}
            >
              {t('attendanceTab.pushToFeishu')}
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* 移动端滚动容器：保持表格 PC 尺寸，用户可左右/上下滑动填写 */}
      <div className="overflow-auto" style={{ WebkitOverflowScrolling: 'touch' as never }}>
        <div ref={(node) => setPreviewCaptureRef(planDate, node)} data-plan-capture={planDate} style={{ minWidth: 960 }}>
          <AttendanceSchedulingPushPanelBody
            loaded={templateLoaded}
            preview={preview}
            cellTexts={cellTexts}
            onCellChange={handleCellChange}
          />
        </div>
      </div>
    </div>
  )
}

function AttendanceSchedulingPushPanelBody({
  loaded,
  preview,
  cellTexts,
  onCellChange,
}: {
  loaded: boolean
  preview: ReturnType<typeof buildManualAttendanceSchedulingPlanPreview>
  cellTexts: Record<string, string>
  onCellChange: (key: string, text: string) => void
}) {
  const { t } = useTranslation('pushNotifications')

  if (!loaded) {
    return (
      <Typography.Text type="secondary" className="block py-8 text-center text-sm">
        {t('attendanceTab.loadingTemplate')}
      </Typography.Text>
    )
  }

  return (
    <AttendanceSchedulingPlanPreviewView
      preview={preview}
      cellTexts={cellTexts}
      onCellChange={onCellChange}
    />
  )
}
