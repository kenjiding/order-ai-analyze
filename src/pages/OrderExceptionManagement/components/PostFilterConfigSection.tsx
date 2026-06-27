import { Button, Input, InputNumber, Select } from 'antd'
import { ChevronLeft, ChevronRight, Clock, DollarSign, Filter, Scale, Store } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { countActivePostFilters } from '../postFilter/defaults'
import type { PostFilterConfig } from '../postFilter/types'

const CURRENCY_OPTIONS = [
  { value: 'aud', label: 'AUD' },
  { value: 'usd', label: 'USD' },
]

function FilterGroup({
  icon,
  label,
  active,
  children,
}: {
  icon: ReactNode
  label: string
  active: boolean
  children: ReactNode
}) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={[
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded',
            active ? 'text-[#1f6f68]' : 'text-slate-400',
          ].join(' ')}
        >
          {icon}
        </span>
        <span className="text-xs font-semibold text-slate-800">{label}</span>
        {active ? (
          <span className="ml-auto inline-flex h-1.5 w-1.5 rounded-full bg-[#1f6f68]" aria-hidden />
        ) : null}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[11px] font-medium text-slate-500">{children}</div>
}

type Props = {
  draft: PostFilterConfig
  applied: PostFilterConfig
  onChange: (next: PostFilterConfig) => void
  onApply: () => void
  maxHeight?: number
}

export function PostFilterConfigSection({ draft, applied, onChange, onApply, maxHeight }: Props) {
  const [expanded, setExpanded] = useState(true)
  const { amountFilter, weightFilter, merchantFilter, timeoutFilter } = draft
  const appliedCount = countActivePostFilters(applied)

  function patchAmount(patch: Partial<typeof amountFilter>) {
    onChange({ ...draft, amountFilter: { ...amountFilter, ...patch } })
  }
  function patchWeight(patch: Partial<typeof weightFilter>) {
    onChange({ ...draft, weightFilter: { ...weightFilter, ...patch } })
  }
  function patchMerchant(patch: Partial<typeof merchantFilter>) {
    onChange({ ...draft, merchantFilter: { ...merchantFilter, ...patch } })
  }
  function patchTimeout(patch: Partial<typeof timeoutFilter>) {
    onChange({ ...draft, timeoutFilter: { ...timeoutFilter, ...patch } })
  }

  const amountActive = amountFilter.minValue != null || amountFilter.maxValue != null
  const weightActive = weightFilter.minKg != null || weightFilter.maxKg != null
  const merchantActive =
    merchantFilter.merchantCodes.length > 0 || merchantFilter.merchantNameKeyword.trim() !== ''
  const timeoutActive = timeoutFilter.minDays != null || timeoutFilter.maxDays != null

  const panelStyle = {
    borderColor: 'var(--admin-line)',
    ...(maxHeight != null ? { maxHeight } : {}),
  }

  if (!expanded) {
    return (
      <aside
        className="flex w-11 shrink-0 flex-col self-stretch border-l"
        style={panelStyle}
        aria-label="后置过滤"
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex h-full w-full flex-col items-center gap-2 py-4 text-slate-400 transition hover:bg-slate-50/80 hover:text-[#1f6f68]"
          aria-label="展开后置过滤"
          title="展开后置过滤"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          <Filter className="h-4 w-4 shrink-0" aria-hidden />
          {appliedCount > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1f6f68]/10 px-1 text-[10px] font-semibold text-[#1f6f68]">
              {appliedCount}
            </span>
          ) : null}
          <span className="flex flex-col items-center gap-2 text-[10px] font-medium text-slate-500" aria-hidden>
            {'后置过滤'.split('').map((char) => (
              <span key={char}>{char}</span>
            ))}
          </span>
        </button>
      </aside>
    )
  }

  return (
    <aside
      className="flex w-[280px] shrink-0 flex-col self-stretch border-l"
      style={panelStyle}
      aria-label="后置过滤"
    >
      <div className="mb-1 flex shrink-0 items-center gap-2 px-5">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label="收起后置过滤"
          title="收起"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
        <h4 className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
          后置过滤
        </h4>
        {appliedCount > 0 ? (
          <span className="shrink-0 text-[11px] font-medium text-[#1f6f68]">{appliedCount} 项生效</span>
        ) : (
          <span className="shrink-0 text-[11px] text-slate-400">留空即不过滤</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5">
        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
          仅过滤已完成分析的结果行，不影响 AI 分析过程。
        </p>

        <div className="divide-y" style={{ borderColor: 'var(--admin-line)' }}>
          <FilterGroup
            icon={<DollarSign className="h-3.5 w-3.5" aria-hidden />}
            label="包裹金额"
            active={amountActive}
          >
            <div>
              <FieldLabel>货币</FieldLabel>
              <Select
                className="w-full"
                value={amountFilter.currency}
                options={CURRENCY_OPTIONS}
                onChange={(v) => patchAmount({ currency: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>大于</FieldLabel>
                <InputNumber
                  className="w-full"
                  placeholder="不限"
                  min={0}
                  value={amountFilter.minValue ?? undefined}
                  onChange={(v) => patchAmount({ minValue: v ?? null })}
                />
              </div>
              <div>
                <FieldLabel>小于</FieldLabel>
                <InputNumber
                  className="w-full"
                  placeholder="不限"
                  min={0}
                  value={amountFilter.maxValue ?? undefined}
                  onChange={(v) => patchAmount({ maxValue: v ?? null })}
                />
              </div>
            </div>
          </FilterGroup>

          <FilterGroup
            icon={<Scale className="h-3.5 w-3.5" aria-hidden />}
            label="重量 kg"
            active={weightActive}
          >
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>大于</FieldLabel>
                <InputNumber
                  className="w-full"
                  placeholder="不限"
                  min={0}
                  step={0.01}
                  value={weightFilter.minKg ?? undefined}
                  onChange={(v) => patchWeight({ minKg: v ?? null })}
                />
              </div>
              <div>
                <FieldLabel>小于</FieldLabel>
                <InputNumber
                  className="w-full"
                  placeholder="不限"
                  min={0}
                  step={0.01}
                  value={weightFilter.maxKg ?? undefined}
                  onChange={(v) => patchWeight({ maxKg: v ?? null })}
                />
              </div>
            </div>
          </FilterGroup>

          <FilterGroup
            icon={<Store className="h-3.5 w-3.5" aria-hidden />}
            label="商家"
            active={merchantActive}
          >
            <div>
              <FieldLabel>商家编码（Enter 确认，多项 OR）</FieldLabel>
              <Select
                mode="tags"
                className="w-full"
                placeholder="输入编码"
                value={merchantFilter.merchantCodes}
                onChange={(v: string[]) => patchMerchant({ merchantCodes: v })}
                tokenSeparators={[',', ' ']}
                open={false}
              />
            </div>
            <div>
              <FieldLabel>名称关键词（模糊，与编码 OR）</FieldLabel>
              <Input
                placeholder="留空则不限"
                value={merchantFilter.merchantNameKeyword}
                onChange={(e) => patchMerchant({ merchantNameKeyword: e.target.value })}
              />
            </div>
          </FilterGroup>

          <FilterGroup
            icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
            label="超时天数"
            active={timeoutActive}
          >
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>最少</FieldLabel>
                <InputNumber
                  className="w-full"
                  placeholder="不限"
                  min={0}
                  value={timeoutFilter.minDays ?? undefined}
                  onChange={(v) => patchTimeout({ minDays: v ?? null })}
                />
              </div>
              <div>
                <FieldLabel>最多</FieldLabel>
                <InputNumber
                  className="w-full"
                  placeholder="不限"
                  min={0}
                  value={timeoutFilter.maxDays ?? undefined}
                  onChange={(v) => patchTimeout({ maxDays: v ?? null })}
                />
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">基于最后一次轨迹事件距今天数</p>
          </FilterGroup>
        </div>
        </div>
      </div>

      <div className="mt-4 shrink-0 px-5 pt-3" style={{ borderTop: '1px solid var(--admin-line)' }}>
        <Button type="primary" block icon={<Filter className="h-4 w-4" aria-hidden />} onClick={onApply}>
          过滤
        </Button>
      </div>
    </aside>
  )
}
