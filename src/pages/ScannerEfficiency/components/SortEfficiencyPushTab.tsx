import { Button, Checkbox, Empty, Typography } from 'antd'
import { Send } from 'lucide-react'
import { SKIP_FEISHU_CAPTURE_ATTR } from '../feishuLevel1ScreenshotCapture'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import {
  PUSH_CHART_ALL_KEYS,
  PUSH_CHART_LABELS,
  getAvailableChartKeys,
  type PushChartKey,
  type ScannerLevel1FeishuPush,
} from '../useScannerLevel1FeishuPush'

type Props = {
  vm: Pick<ScannerEfficiencyViewModel, 'attendanceResult' | 'scannerResult'>
  level1Push: ScannerLevel1FeishuPush
}

export default function SortEfficiencyPushTab({ vm, level1Push }: Props) {
  const { attendanceResult, scannerResult } = vm

  const {
    level1PushWorking,
    selectedChartKeys,
    setSelectedChartKeys,
    pushLevel1EfficiencyScreenshots,
  } = level1Push

  const availableChartKeys = getAvailableChartKeys(Boolean(attendanceResult), Boolean(scannerResult))
  const pushDisabled = level1PushWorking || !selectedChartKeys.length || !availableChartKeys.length

  const chartCheckboxOptions = PUSH_CHART_ALL_KEYS.map((key) => ({
    value: key,
    label: PUSH_CHART_LABELS[key],
    disabled: !availableChartKeys.includes(key),
  }))

  const selectedAvailableKeys = selectedChartKeys.filter((k) => availableChartKeys.includes(k))

  if (!attendanceResult && !scannerResult) {
    return (
      <Empty
        className="py-12"
        description="请先上传到件扫描文件（含扫描员列）或考勤数据后再配置效率图表推送。"
      />
    )
  }

  if (!availableChartKeys.length) {
    return (
      <Empty
        className="py-12"
        description="当前数据不足以生成任何可推送图表，请确认到件含扫描员列或已上传考勤。"
      />
    )
  }

  return (
    <div className="sort-efficiency-push-tab space-y-4">
      <div className="space-y-3 rounded-[10px] border border-[var(--admin-line)] bg-gradient-to-br from-violet-50 via-[var(--admin-surface-soft)] to-[var(--admin-accent-soft)] px-3.5 py-3">
        <Typography.Text type="secondary" className="block text-xs leading-relaxed">
          选择要推送的图表；推送时按当前数据截图，发送至「推送通知 → 仓库效率推送」中已启用的
          webhook。含扫描员汇总时将附带 AI 数据点评。
        </Typography.Text>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-violet-200/60 pt-3">
          <div {...{ [SKIP_FEISHU_CAPTURE_ATTR]: '' }}>
            <Checkbox.Group
              value={selectedAvailableKeys}
              onChange={(keys) => setSelectedChartKeys(keys as PushChartKey[])}
              disabled={level1PushWorking}
              options={chartCheckboxOptions}
              className="flex flex-wrap gap-x-4 gap-y-2"
            />
          </div>
          <div {...{ [SKIP_FEISHU_CAPTURE_ATTR]: '' }}>
            <Button
              type="primary"
              icon={<Send className="h-4 w-4" />}
              loading={level1PushWorking}
              disabled={pushDisabled}
              onClick={() => void pushLevel1EfficiencyScreenshots()}
            >
              {level1PushWorking ? '正在推送…' : '推送到飞书'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
