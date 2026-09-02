import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, Space, TimePicker } from 'antd'
import dayjs from 'dayjs'
import { Gauge, Save } from 'lucide-react'
import { FormSection } from '../../../components/FormSection'
import { StationSelect } from '../../../components/Layout/StationSelect'
import {
  SupplierPushConfigSection,
  type SupplierPushConfig,
} from '../../../shared/supplierPushConfig'
import { useGlobalFilterStore } from '../../../stores/globalFilterStore'
import type {
  DispatchPerformanceConfig,
  DispatchPerformanceConfigDraft,
} from '../dispatchPerformanceTypes'

/** 与后端 dispatch24hStats/settleTime.ts 的 DEFAULT_SETTLE_TIME 保持一致 */
const DEFAULT_SETTLE_TIME = '16:00'

type Props = {
  open: boolean
  onClose: () => void
  editing: DispatchPerformanceConfig | null
  saving: boolean
  catalogConfigs: SupplierPushConfig[]
  catalogLoading: boolean
  onSubmit: (draft: DispatchPerformanceConfigDraft) => void
}

export function DispatchPerformanceConfigDrawer({
  open,
  onClose,
  editing,
  saving,
  catalogConfigs,
  catalogLoading,
  onSubmit,
}: Props) {
  const { stations } = useGlobalFilterStore()
  const [stationCode, setStationCode] = useState('')
  const [pushConfigIds, setPushConfigIds] = useState<string[]>([])
  const [settleTime, setSettleTime] = useState(DEFAULT_SETTLE_TIME)
  const [error, setError] = useState<string | null>(null)

  const catalogIdSet = new Set(catalogConfigs.map((config) => config.id))

  useEffect(() => {
    if (!open) return
    // 抽屉打开时把「编辑对象」同步进表单 state，与 DispatchAlarmScheduleDrawer 同一写法。
    // set-state-in-effect 规则针对的是派生状态引发的级联渲染，这里是把外部 props 灌进
    // 可编辑表单的一次性初始化，只在 open 翻转时发生。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStationCode(editing?.stationCode ?? '')
    setPushConfigIds(editing?.pushConfigIds ?? [])
    setSettleTime(editing?.settleTime || DEFAULT_SETTLE_TIME)
    setError(null)
  }, [open, editing])

  const handleConfirm = () => {
    if (!stationCode) {
      setError('请选择站点')
      return
    }
    // 目录之外的 id（换过州、供应商配置被删）不提交，否则结算时会静默少一家
    const scopedPushConfigIds = pushConfigIds.filter((id) => catalogIdSet.has(id))
    if (scopedPushConfigIds.length === 0) {
      setError('请至少选择一个供应商')
      return
    }
    // 站点名只是展示用快照，避免列表页为了显示名字再去查 iMile
    const stationName = stations.find((s) => s.value === stationCode)?.label ?? ''
    onSubmit({
      stationCode,
      stationName,
      pushConfigIds: scopedPushConfigIds,
      settleTime,
      isEnabled: editing?.isEnabled ?? true,
    })
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={640}
      maskClosable={!saving}
      destroyOnHidden
      title={
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
          <span>{editing ? '编辑统计配置' : '添加统计配置'}</span>
        </div>
      }
      footer={
        <Space className="justify-end w-full">
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            type="primary"
            icon={<Save className="h-3.5 w-3.5" />}
            onClick={handleConfirm}
            loading={saving}
          >
            确认
          </Button>
        </Space>
      }
    >
      <div className="space-y-5">
        <FormSection icon={Gauge} title="基础配置">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">站点</span>
              <StationSelect value={stationCode} onChange={setStationCode} disabled={saving} />
              <span className="text-xs text-slate-400">一个站点只能有一条配置</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">触发统计时间</span>
              <TimePicker
                value={dayjs(settleTime, 'HH:mm')}
                format="HH:mm"
                minuteStep={5}
                allowClear={false}
                disabled={saving}
                className="!w-28"
                onChange={(val) => {
                  if (val) setSettleTime(val.format('HH:mm'))
                }}
              />
              <span className="text-xs text-slate-400">每天这个点开始跑统计，按该站点所属州的本地时间</span>
            </div>
          </div>
        </FormSection>

        <SupplierPushConfigSection
          configs={catalogConfigs}
          value={pushConfigIds}
          onChange={setPushConfigIds}
          disabled={saving}
          catalogLoading={catalogLoading}
          // 统计不推送任何消息，没配 Webhook / 飞书群的供应商也必须能勾（后端只要求 vendorCode，
          // 见 dailyStatsJob.resolveStationTargets）；沿用推送口径会让那家的单永久缺失
          requirePushable={false}
          description="只统计这里勾选的供应商"
          footnote="漏勾的那家历史数据会永久缺失（结算不回补），请对照该站点实际承运商核对。"
        />

        <Alert
          type="info"
          showIcon
          message="统计时机"
          description={
            <div className="space-y-1 text-xs">
              <div>确认后由定时任务每日在「触发统计时间」自动统计，两个指标结算时机差一天：</div>
              <div>· 11点前出仓率 —— 结算「昨天到件」那批，出仓阈值一过即定终值</div>
              <div>· 24小时派签率 —— 结算「前天到件」那批，必须等 24 小时窗口到期</div>
              <div className="text-slate-400">
                提前算派签会被归班盘点重新派出，数据会乱，所以要多等一天。
                触发时间也别早于 11:00，否则会把「窗口还没到期」记成未达标。
              </div>
            </div>
          }
        />

        {error ? <Alert type="error" showIcon message={error} /> : null}
      </div>
    </Drawer>
  )
}
