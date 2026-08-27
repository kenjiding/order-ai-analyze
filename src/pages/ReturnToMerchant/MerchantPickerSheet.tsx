import { Popup } from 'react-vant'
import { Check } from 'lucide-react'
import { RETURN_MERCHANTS } from '../../../shared/returnToMerchant/merchants'

/**
 * 商家切换底部面板。
 *
 * 不用 ActionSheet 的 actions 渲染：它没有「当前选中」这个态，也不显示在改哪一条码，
 * 改错行看不出来。这里用 Popup 自绘卡片列表，选中态是全页唯一的着色点。
 */
export function MerchantPickerSheet({
  visible,
  scanNumber,
  clientCode,
  onSelect,
  onClose,
}: {
  visible: boolean
  scanNumber: string
  clientCode: string
  onSelect: (clientCode: string) => void
  onClose: () => void
}) {
  return (
    <Popup
      visible={visible}
      position="bottom"
      round
      closeOnClickOverlay
      safeAreaInsetBottom
      onClose={onClose}
    >
      <div className="px-3 pb-3 pt-2">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-zinc-200" aria-hidden />

        <div className="mb-3 px-1">
          <p className="text-sm font-semibold text-zinc-900">选择商家</p>
          {/* 带上条码，改错行时能立刻发现 */}
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{scanNumber}</p>
        </div>

        <ul className="space-y-2" role="radiogroup" aria-label="商家">
          {RETURN_MERCHANTS.map((m) => {
            const active = m.clientCode === clientCode
            return (
              <li key={m.clientCode}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelect(m.clientCode)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:scale-[0.99] ${
                    active
                      ? 'border-[#2f8f87] bg-[#e1f5f1]'
                      : 'border-zinc-200 bg-white active:bg-zinc-50'
                  }`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-bold ${
                      active ? 'bg-[#1f6f68] text-white' : 'bg-zinc-100 text-zinc-600'
                    }`}
                    aria-hidden
                  >
                    {m.label.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-900">
                      {m.label}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500">
                      {m.clientCode}
                    </span>
                  </span>
                  {active && (
                    <Check className="h-5 w-5 shrink-0 text-[#1f6f68]" aria-hidden strokeWidth={2.5} />
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-xl bg-zinc-100 py-3 text-sm font-semibold text-zinc-600 active:scale-[0.99] active:bg-zinc-200"
        >
          取消
        </button>
      </div>
    </Popup>
  )
}
