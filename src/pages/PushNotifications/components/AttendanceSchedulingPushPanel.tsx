import { Button, DatePicker, Tooltip, Typography } from 'antd'
import { Save, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  mergeCellTextsWithBase,
  remapCellTextsToPlanDate,
  stripPlanDatePrefixFromCellTexts,
  type AttendanceSchedulingPushTemplate,
} from '../attendanceSchedulingPushTemplateStorage'
import {
  loadAttendanceSchedulingPushTemplate,
  persistAttendanceSchedulingPushTemplate,
} from '../attendanceSchedulingPushTemplateRepository.idb'
import { showToast } from '../../../utils/toast'

function defaultPlanDate(): string {
  return dayjs().format('YYYY-MM-DD')
}

export function AttendanceSchedulingPushPanel() {
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
        setPlanDate(template.planDate)
        prevPlanDateRef.current = template.planDate
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

    if (!initializedRef.current) {
      initializedRef.current = true
      const template = templateRef.current
      const overlay = template?.cells ? applyPlanDatePrefixToCellTexts(template.cells, planDate) : {}
      setCellTexts(recalculateEfficiencyAchievementRatios(mergeCellTextsWithBase(base, overlay)))
      prevPlanDateRef.current = planDate
      return
    }

    if (prevPlanDateRef.current !== planDate) {
      setCellTexts((prev) => {
        const remapped = remapCellTextsToPlanDate(prev, prevPlanDateRef.current, planDate)
        const withTitle = syncPlanTitleForDateChange(remapped, prevPlanDateRef.current, planDate)
        return recalculateEfficiencyAchievementRatios(mergeCellTextsWithBase(base, withTitle))
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
      const template: AttendanceSchedulingPushTemplate = {
        planDate,
        cells: stripPlanDatePrefixFromCellTexts(cellTexts, planDate),
      }
      await persistAttendanceSchedulingPushTemplate(template)
      templateRef.current = template
      showToast('已保存排班模版，下次进入将自动回填。', 'success')
    } catch {
      showToast('模版保存失败，请重试。', 'error')
    } finally {
      setSavingTemplate(false)
    }
  }, [cellTexts, planDate])

  return (
    <div className="attendance-scheduling-push-tab space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--admin-line)] bg-gradient-to-br from-[var(--admin-sky-soft)] via-[var(--admin-surface-soft)] to-[var(--admin-accent-soft)] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Typography.Text type="secondary" className="text-xs">
              排班日期
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
            保存模版
          </Button>
          <Tooltip title={!canSend ? '无操作权限' : undefined}>
            <Button
              type="primary"
              icon={<Send className="h-4 w-4" />}
              loading={pushing}
              disabled={!canSend || !templateLoaded || pushing}
              onClick={() => {
                if (!canSend) {
                  showToast('无操作权限', 'error')
                  return
                }
                void pushSchedulingPlanPreviews([previewForPush])
              }}
            >
              推送到飞书
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
  if (!loaded) {
    return (
      <Typography.Text type="secondary" className="block py-8 text-center text-sm">
        正在加载排班模版…
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
