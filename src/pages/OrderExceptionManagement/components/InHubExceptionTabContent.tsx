import { InputNumber, Tooltip } from 'antd'
import { Loader2, Warehouse } from 'lucide-react'
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
  const canAnalyze = usePermission(PERMISSION_KEYS.btnOrderExceptionAnalyze)
  const stationCode = useGlobalFilterStore((state) => state.selectedStations[0])

  return (
    <section className="admin-panel p-5">
      <div className="flex items-center gap-2">
        <Warehouse className="h-5 w-5 text-[#2f8f87]" aria-hidden />
        <h3 className="text-sm font-semibold text-slate-950">库内异常订单分析</h3>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        按库内滞留天数区间查询在库运单，自动带入「AI异常订单分析」进行分析，结果显示在该标签的「分析结果」中。
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          大于
          <InputNumber
            min={0}
            value={greaterDays}
            onChange={(value) => onGreaterDaysChange(value == null ? null : Number(value))}
            addonAfter="天"
            disabled={isQuerying}
            className="w-36"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          小于
          <InputNumber
            min={0}
            value={lessDays}
            onChange={(value) => onLessDaysChange(value == null ? null : Number(value))}
            addonAfter="天"
            disabled={isQuerying}
            className="w-36"
          />
        </label>
        <Tooltip title={!canAnalyze ? '无操作权限' : undefined}>
          <button
            type="button"
            disabled={isQuerying || !canAnalyze}
            onClick={onAnalyze}
            className="admin-btn admin-btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isQuerying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            分析
          </button>
        </Tooltip>
      </div>

      {!stationCode ? (
        <p className="mt-3 text-xs text-amber-600">请先在右上角选择责任站点，再进行库内异常订单分析。</p>
      ) : null}

      {queryMeta ? (
        <p className="mt-3 text-xs text-slate-600" aria-live="polite">
          入库区间 {queryMeta.start} ~ {queryMeta.end}，共{' '}
          <span className="font-semibold text-slate-900">{queryMeta.totalResult}</span> 个订单号
          {queryMeta.totalResult > 0 ? '，已跳转至「AI异常订单分析」查看结果' : null}
        </p>
      ) : null}
    </section>
  )
}
