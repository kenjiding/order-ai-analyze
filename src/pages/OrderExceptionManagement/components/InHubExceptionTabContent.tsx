import { InputNumber, Tooltip } from 'antd'
import { Loader2, Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { useGlobalFilterStore } from '../../../stores/globalFilterStore'
import type { InHubQueryMeta } from '../useOrderExceptionManagementPage'

type Props = {
  greaterDays: number | null
  onGreaterDaysChange: (value: number | null) => void
  lessDays: number | null
  onLessDaysChange: (value: number | null) => void
  isQuerying: boolean
  queryMeta: InHubQueryMeta | null
  onAnalyze: () => void
}

export function InHubExceptionTabContent({
  greaterDays,
  onGreaterDaysChange,
  lessDays,
  onLessDaysChange,
  isQuerying,
  queryMeta,
  onAnalyze,
}: Props) {
  const { t } = useTranslation('orderException')
  const canAnalyze = usePermission(PERMISSION_KEYS.btnOrderExceptionAnalyze)
  const stationCode = useGlobalFilterStore((state) => state.selectedStations[0])

  return (
    <section className="admin-panel p-5">
      <div className="flex items-center gap-2">
        <Warehouse className="h-5 w-5 text-[#2f8f87]" aria-hidden />
        <h3 className="text-sm font-semibold text-slate-950">{t('inHub.title')}</h3>
      </div>
      <p className="mt-1 text-xs text-slate-500">{t('inHub.description')}</p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          {t('inHub.greaterThan')}
          <InputNumber
            min={0}
            value={greaterDays}
            onChange={(value) => onGreaterDaysChange(value == null ? null : Number(value))}
            addonAfter={t('inHub.daysUnit')}
            disabled={isQuerying}
            className="w-36"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          {t('inHub.lessThan')}
          <InputNumber
            min={0}
            value={lessDays}
            onChange={(value) => onLessDaysChange(value == null ? null : Number(value))}
            addonAfter={t('inHub.daysUnit')}
            disabled={isQuerying}
            className="w-36"
          />
        </label>
        <Tooltip title={!canAnalyze ? t('noPermission') : undefined}>
          <button
            type="button"
            disabled={isQuerying || !canAnalyze}
            onClick={onAnalyze}
            className="admin-btn admin-btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isQuerying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t('inHub.analyze')}
          </button>
        </Tooltip>
      </div>

      {!stationCode ? (
        <p className="mt-3 text-xs text-amber-600">{t('inHub.selectStationFirst')}</p>
      ) : null}

      {queryMeta ? (
        <p className="mt-3 text-xs text-slate-600" aria-live="polite">
          {t('inHub.queryResult', {
            start: queryMeta.start,
            end: queryMeta.end,
            count: queryMeta.totalResult,
          })}
          {queryMeta.totalResult > 0 ? t('inHub.queryResultWithRedirect') : null}
        </p>
      ) : null}
    </section>
  )
}
