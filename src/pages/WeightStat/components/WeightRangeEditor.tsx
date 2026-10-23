import { Button, Empty, InputNumber } from 'antd'
import { ArrowRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WeightRangeStat } from '../weightStatApi'

type Props = {
  stats: WeightRangeStat[]
  onAdd: (min: number, max: number) => void
  onRemove: (id: string) => void
}

export function WeightRangeEditor({ stats, onAdd, onRemove }: Props) {
  const { t } = useTranslation('weightStat')
  const [min, setMin] = useState<number | null>(null)
  const [max, setMax] = useState<number | null>(null)

  const handleAdd = () => {
    if (min == null || max == null) return
    onAdd(min, max)
    setMin(null)
    setMax(null)
  }

  return (
    <section className="admin-panel space-y-4 p-5">
      <div>
        <h3 className="admin-title text-lg">{t('rangeEditor.title')}</h3>
        <p className="mt-1 text-sm text-slate-500">{t('rangeEditor.subtitle')}</p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700">
          {t('rangeEditor.addLabel')}
        </label>
        <div
          className="inline-flex items-center gap-2 rounded-lg bg-white py-1.5 pl-3 pr-1.5"
          style={{ border: '1px solid var(--admin-line)' }}
        >
          <label htmlFor="weight-range-min" className="text-xs text-slate-400">
            {t('rangeEditor.min')}
          </label>
          <InputNumber
            id="weight-range-min"
            variant="borderless"
            className="w-20"
            min={0}
            step={0.1}
            value={min}
            onChange={(v) => setMin(v)}
            onPressEnter={handleAdd}
          />
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
          <label htmlFor="weight-range-max" className="text-xs text-slate-400">
            {t('rangeEditor.max')}
          </label>
          <InputNumber
            id="weight-range-max"
            variant="borderless"
            className="w-20"
            min={0}
            step={0.1}
            value={max}
            onChange={(v) => setMax(v)}
            onPressEnter={handleAdd}
          />
          <div className="mx-1 h-5 w-px shrink-0" style={{ backgroundColor: 'var(--admin-line)' }} />
          <Button
            type="primary"
            icon={<Plus className="h-4 w-4" aria-hidden />}
            disabled={min == null || max == null}
            onClick={handleAdd}
          >
            {t('rangeEditor.add')}
          </Button>
        </div>
      </div>

      {stats.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('rangeEditor.empty')} />
      ) : (
        <div>
          <p className="mb-2 text-xs text-slate-400">{t('rangeEditor.added', { count: stats.length })}</p>
          <div className="flex flex-wrap gap-2">
            {stats.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 whitespace-nowrap rounded-full bg-white py-1 pl-3 pr-1.5 text-sm transition hover:shadow-[0_1px_4px_rgba(15,23,42,0.08)]"
                style={{ border: '1px solid var(--admin-line)' }}
              >
                <span className="tabular-nums text-slate-700">
                  [{r.min}, {r.max}]
                </span>
                <span
                  className="tabular-nums rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: 'var(--admin-accent-soft)', color: 'var(--admin-accent)' }}
                >
                  {r.count}
                </span>
                <button
                  type="button"
                  aria-label={t('rangeEditor.removeLabel')}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={() => onRemove(r.id)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
