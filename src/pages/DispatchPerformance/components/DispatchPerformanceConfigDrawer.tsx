import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, InputNumber, Space, TimePicker } from 'antd'
import dayjs from 'dayjs'
import { Gauge, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation(['dispatchPerformance', 'common'])
  const { stations } = useGlobalFilterStore()
  const [stationCode, setStationCode] = useState('')
  const [pushConfigIds, setPushConfigIds] = useState<string[]>([])
  const [settleTime, setSettleTime] = useState(DEFAULT_SETTLE_TIME)
  const [minSortingWaybills, setMinSortingWaybills] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const catalogIdSet = new Set(catalogConfigs.map((config) => config.id))

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStationCode(editing?.stationCode ?? '')
    setPushConfigIds(editing?.pushConfigIds ?? [])
    setSettleTime(editing?.settleTime || DEFAULT_SETTLE_TIME)
    setMinSortingWaybills(editing?.minSortingWaybills ?? null)
    setError(null)
  }, [open, editing])

  const handleConfirm = () => {
    if (!stationCode) {
      setError(t('validation.selectStation', { ns: 'dispatchPerformance' }))
      return
    }
    const scopedPushConfigIds = pushConfigIds.filter((id) => catalogIdSet.has(id))
    if (scopedPushConfigIds.length === 0) {
      setError(t('validation.selectVendor', { ns: 'dispatchPerformance' }))
      return
    }
    const stationName = stations.find((s) => s.value === stationCode)?.label ?? ''
    onSubmit({
      stationCode,
      stationName,
      pushConfigIds: scopedPushConfigIds,
      settleTime,
      minSortingWaybills,
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
          <span>
            {editing
              ? t('drawer.editTitle', { ns: 'dispatchPerformance' })
              : t('drawer.addTitle', { ns: 'dispatchPerformance' })}
          </span>
        </div>
      }
      footer={
        <Space className="justify-end w-full">
          <Button onClick={onClose} disabled={saving}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button
            type="primary"
            icon={<Save className="h-3.5 w-3.5" />}
            onClick={handleConfirm}
            loading={saving}
          >
            {t('confirm', { ns: 'common' })}
          </Button>
        </Space>
      }
    >
      <div className="space-y-5">
        <FormSection icon={Gauge} title={t('drawer.basicConfig', { ns: 'dispatchPerformance' })}>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">
                {t('drawer.station', { ns: 'dispatchPerformance' })}
              </span>
              <StationSelect value={stationCode} onChange={setStationCode} disabled={saving} />
              <span className="text-xs text-slate-400">
                {t('drawer.oneStationOnly', { ns: 'dispatchPerformance' })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">
                {t('drawer.triggerTime', { ns: 'dispatchPerformance' })}
              </span>
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
              <span className="text-xs font-medium text-slate-500">
                {t('drawer.minSortingWaybills', { ns: 'dispatchPerformance' })}
              </span>
              <InputNumber
                value={minSortingWaybills}
                min={1}
                step={100}
                placeholder={t('drawer.minSortingWaybillsPlaceholder', { ns: 'dispatchPerformance' })}
                disabled={saving}
                className="!w-32"
                onChange={(val) => setMinSortingWaybills(typeof val === 'number' ? val : null)}
              />
            </div>
          </div>
        </FormSection>

        <SupplierPushConfigSection
          configs={catalogConfigs}
          value={pushConfigIds}
          onChange={setPushConfigIds}
          disabled={saving}
          catalogLoading={catalogLoading}
          requirePushable={false}
          description={t('drawer.vendorDescription', { ns: 'dispatchPerformance' })}
          footnote={t('drawer.vendorFootnote', { ns: 'dispatchPerformance' })}
        />

        <Alert
          type="info"
          showIcon
          message={t('drawer.timingTitle', { ns: 'dispatchPerformance' })}
          description={
            <div className="space-y-1 text-xs">
              <div>{t('drawer.timingIntro', { ns: 'dispatchPerformance' })}</div>
              <div>{t('drawer.timingBefore11', { ns: 'dispatchPerformance' })}</div>
              <div>{t('drawer.timingSign24h', { ns: 'dispatchPerformance' })}</div>
              <div className="text-slate-400">
                {t('drawer.timingFootnote', { ns: 'dispatchPerformance' })}
              </div>
            </div>
          }
        />

        {error ? <Alert type="error" showIcon message={error} /> : null}
      </div>
    </Drawer>
  )
}
