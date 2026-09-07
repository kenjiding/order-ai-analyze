import { Button, Checkbox, Empty, Tooltip, Typography } from 'antd'
import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { SKIP_FEISHU_CAPTURE_ATTR } from '../feishuLevel1ScreenshotCapture'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import {
  PUSH_CHART_ALL_KEYS,
  pushChartLabel,
  getAvailableChartKeys,
  type PushChartKey,
  type ScannerLevel1FeishuPush,
} from '../useScannerLevel1FeishuPush'

type Props = {
  vm: Pick<ScannerEfficiencyViewModel, 'attendanceResult' | 'scannerResult'>
  level1Push: ScannerLevel1FeishuPush
}

export default function SortEfficiencyPushTab({ vm, level1Push }: Props) {
  const { t } = useTranslation('scannerEfficiency')
  const canSend = usePermission(PERMISSION_KEYS.btnPushNotificationsWarehouseEfficiency)
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
    label: pushChartLabel(key),
    disabled: !availableChartKeys.includes(key),
  }))

  const selectedAvailableKeys = selectedChartKeys.filter((k) => availableChartKeys.includes(k))

  if (!attendanceResult && !scannerResult) {
    return (
      <Empty
        className="py-12"
        description={t('push.emptyNeedData')}
      />
    )
  }

  if (!availableChartKeys.length) {
    return (
      <Empty
        className="py-12"
        description={t('push.emptyNoCharts')}
      />
    )
  }

  return (
    <div className="sort-efficiency-push-tab space-y-4">
      <div className="space-y-3 rounded-[10px] border border-[var(--admin-line)] bg-gradient-to-br from-violet-50 via-[var(--admin-surface-soft)] to-[var(--admin-accent-soft)] px-3.5 py-3">
        <Typography.Text type="secondary" className="block text-xs leading-relaxed">
          {t('push.desc')}
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
            <Tooltip title={!canSend ? t('common.noPermission') : undefined}>
              <Button
                type="primary"
                icon={<Send className="h-4 w-4" />}
                loading={level1PushWorking}
                disabled={!canSend || pushDisabled}
                onClick={() => {
                  if (!canSend) {
                    return
                  }
                  void pushLevel1EfficiencyScreenshots()
                }}
              >
                {level1PushWorking ? t('push.pushing') : t('push.pushToFeishu')}
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
}
