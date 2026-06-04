import { Button, Empty, Tabs, Typography } from 'antd'
import { Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  buildAllAttendanceSchedulingPlanPreviews,
  flattenPreviewCellTexts,
  type AttendanceSchedulingPlanPreview,
} from '../attendanceSchedulingPlanPreviewModel'
import { SKIP_FEISHU_CAPTURE_ATTR } from '../feishuLevel1ScreenshotCapture'
import { useAttendanceSchedulingFeishuPush } from '../useAttendanceSchedulingFeishuPush'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import AttendanceSchedulingPlanPreviewView from './AttendanceSchedulingPlanPreview'

type Props = {
  vm: Pick<
    ScannerEfficiencyViewModel,
    'attendanceResult' | 'attendanceRows' | 'scannerResult' | 'dailyLaborCostByDate'
  >
}

function formatTabLabel(preview: AttendanceSchedulingPlanPreview): string {
  return preview.title.replace(/^阿德莱德仓库 出勤及排班计划 /, '')
}

export default function AttendanceSchedulingPushTab({ vm }: Props) {
  const { attendanceResult, attendanceRows, scannerResult, dailyLaborCostByDate } = vm
  const { pushing, setPreviewCaptureRef, pushSchedulingPlanPreviews } = useAttendanceSchedulingFeishuPush()

  const previews = useMemo(() => {
    if (!attendanceResult) return []
    return buildAllAttendanceSchedulingPlanPreviews({
      attendanceResult,
      attendanceRows,
      scannerResult,
      dailyLaborCostByDate,
    })
  }, [attendanceResult, attendanceRows, scannerResult, dailyLaborCostByDate])

  const [activePlanDate, setActivePlanDate] = useState<string>()
  const [cellTextsByPlan, setCellTextsByPlan] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    if (!previews.length) {
      setActivePlanDate(undefined)
      setCellTextsByPlan({})
      return
    }
    setActivePlanDate((prev) => (prev && previews.some((p) => p.planDate === prev) ? prev : previews[0]!.planDate))
    setCellTextsByPlan((prev) => {
      const next: Record<string, Record<string, string>> = {}
      for (const preview of previews) {
        const base = flattenPreviewCellTexts(preview)
        next[preview.planDate] = { ...base, ...prev[preview.planDate] }
      }
      return next
    })
  }, [previews])

  const handleCellChange = (planDate: string, key: string, text: string) => {
    setCellTextsByPlan((prev) => ({
      ...prev,
      [planDate]: {
        ...prev[planDate],
        [key]: text,
      },
    }))
  }

  if (!attendanceResult) {
    return (
      <Empty
        className="py-12"
        description="请先上传考勤数据后再配置排班推送预览。"
      />
    )
  }

  if (!previews.length) {
    return (
      <Empty
        className="py-12"
        description="统计窗口内无开仓日，暂无排班计划可预览或推送。"
      />
    )
  }

  return (
    <div className="attendance-scheduling-push-tab space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--admin-line)] bg-gradient-to-br from-[var(--admin-sky-soft)] via-[var(--admin-surface-soft)] to-[var(--admin-accent-soft)] px-3.5 py-2.5">
        <Typography.Text type="secondary" className="max-w-2xl text-xs leading-relaxed">
          预览可直接编辑；推送时按当前内容截图，发送至「推送通知 → 仓库出勤/排班推送」中已启用的 webhook。
        </Typography.Text>
        <div {...{ [SKIP_FEISHU_CAPTURE_ATTR]: '' }}>
          <Button
            type="primary"
            icon={<Send className="h-4 w-4" />}
            loading={pushing}
            onClick={() => void pushSchedulingPlanPreviews(previews)}
          >
            推送到飞书
          </Button>
        </div>
      </div>

      <Tabs
        activeKey={activePlanDate}
        onChange={setActivePlanDate}
        className="attendance-scheduling-push-tab__day-tabs"
        items={previews.map((preview) => ({
          key: preview.planDate,
          label: formatTabLabel(preview),
          forceRender: true,
          children: (
            <div
              ref={(node) => setPreviewCaptureRef(preview.planDate, node)}
              data-plan-capture={preview.planDate}
              className=""
            >
              <AttendanceSchedulingPlanPreviewView
                preview={preview}
                cellTexts={cellTextsByPlan[preview.planDate] ?? {}}
                onCellChange={(key, text) => handleCellChange(preview.planDate, key, text)}
              />
            </div>
          ),
        }))}
      />
    </div>
  )
}
