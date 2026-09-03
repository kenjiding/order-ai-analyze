import { useEffect, useMemo, useState } from 'react'
import { Segmented, Select } from 'antd'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { fetchReconciliation } from '../../../containerManagement/api'
import { accountKindLabel, containerTypeLabel } from '../../../containerManagement/constants'
import type {
  AccountKind,
  ContainerAccount,
  ContainerType,
  ReconciliationRow,
  ReconciliationSummary,
} from '../../../containerManagement/types'
import { showToast } from '../../../utils/toast'

type Props = {
  accounts: ContainerAccount[]
}

type ViewFilter = 'open' | 'all'

/** 应收 / 应付方向上的一笔明细：net 已按方向取正，out/in 保留原值用于推导 */
type DirItem = {
  type: ContainerType
  amount: number
  outQty: number
  inQty: number
  counterpartyId: string
}

/** 一个对手方在某方向上的所有明细，按对手方聚合 */
type PartyEntry = {
  id: string
  name: string
  kind: AccountKind
  items: DirItem[]
  total: number
}

/** 在途 / 已结清用的轻量条目 */
type Party = {
  id: string
  name: string
  kind: AccountKind
  pendingOut: number
  pendingIn: number
}

type Grouped = {
  receivables: PartyEntry[]
  payables: PartyEntry[]
  pending: Party[]
  settled: Party[]
}

function groupRows(rows: ReconciliationRow[]): Grouped {
  const rec = new Map<string, PartyEntry>()
  const pay = new Map<string, PartyEntry>()
  const meta = new Map<
    string,
    { name: string; kind: AccountKind; pendingOut: number; pendingIn: number; hasNet: boolean; hasHistory: boolean }
  >()

  const ensure = (map: Map<string, PartyEntry>, row: ReconciliationRow) => {
    let entry = map.get(row.counterpartyId)
    if (!entry) {
      entry = { id: row.counterpartyId, name: row.counterpartyName, kind: row.counterpartyKind, items: [], total: 0 }
      map.set(row.counterpartyId, entry)
    }
    return entry
  }

  for (const row of rows) {
    let m = meta.get(row.counterpartyId)
    if (!m) {
      m = { name: row.counterpartyName, kind: row.counterpartyKind, pendingOut: 0, pendingIn: 0, hasNet: false, hasHistory: false }
      meta.set(row.counterpartyId, m)
    }
    m.pendingOut += row.pendingOut
    m.pendingIn += row.pendingIn
    if (row.outQty || row.inQty) m.hasHistory = true

    if (row.net > 0) {
      m.hasNet = true
      const e = ensure(rec, row)
      e.items.push({ type: row.containerType, amount: row.net, outQty: row.outQty, inQty: row.inQty, counterpartyId: row.counterpartyId })
      e.total += row.net
    } else if (row.net < 0) {
      m.hasNet = true
      const e = ensure(pay, row)
      e.items.push({ type: row.containerType, amount: -row.net, outQty: row.outQty, inQty: row.inQty, counterpartyId: row.counterpartyId })
      e.total += -row.net
    }
  }

  const byTotalDesc = (a: PartyEntry, b: PartyEntry) => b.total - a.total
  const pending: Party[] = []
  const settled: Party[] = []
  for (const [id, m] of meta) {
    if (m.pendingOut || m.pendingIn) {
      pending.push({ id, name: m.name, kind: m.kind, pendingOut: m.pendingOut, pendingIn: m.pendingIn })
    }
    // 有过往来、当前既不欠也不被欠，也没有在途：纯已结清
    if (!m.hasNet && !m.pendingOut && !m.pendingIn && m.hasHistory) {
      settled.push({ id, name: m.name, kind: m.kind, pendingOut: 0, pendingIn: 0 })
    }
  }

  return {
    receivables: [...rec.values()].sort(byTotalDesc),
    payables: [...pay.values()].sort(byTotalDesc),
    pending: pending.sort((a, b) => b.pendingOut + b.pendingIn - (a.pendingOut + a.pendingIn)),
    settled,
  }
}

function transfersUrl(fromAccountId: string, toAccountId: string) {
  return `/container/transfers?${new URLSearchParams({
    fromAccountId,
    toAccountId,
    status: 'CONFIRMED',
  })}`
}

function QtyLink({ qty, to }: { qty: number; to: string }) {
  if (!qty) return <span className="tabular-nums text-slate-400">0</span>
  return (
    <Link to={to} className="tabular-nums text-[#1f6f68] underline-offset-2 hover:underline">
      {qty}
    </Link>
  )
}

/** 展开后的推导行：我发出 − 对方发来 = 净额，前两个数可点进流转 */
function Derivation({ item, tone, accountId }: { item: DirItem; tone: 'rec' | 'pay'; accountId: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-slate-500">{containerTypeLabel[item.type]}</span>
      <span className="flex items-center gap-1.5 tabular-nums text-slate-600">
        <span className="text-[11px] text-slate-400">发出</span>
        <QtyLink qty={item.outQty} to={transfersUrl(accountId, item.counterpartyId)} />
        <span className="text-slate-300">−</span>
        <span className="text-[11px] text-slate-400">收到</span>
        <QtyLink qty={item.inQty} to={transfersUrl(item.counterpartyId, accountId)} />
        <span className="text-slate-300">=</span>
        <span className={`font-semibold ${tone === 'rec' ? 'text-[#1f6f68]' : 'text-rose-600'}`}>
          {item.amount}
        </span>
      </span>
    </div>
  )
}

function PartyRow({
  entry,
  tone,
  accountId,
  expanded,
  onToggle,
}: {
  entry: PartyEntry
  tone: 'rec' | 'pay'
  accountId: string
  expanded: boolean
  onToggle: () => void
}) {
  const numTone = tone === 'rec' ? 'text-[#1f6f68]' : 'text-rose-600'
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 motion-reduce:transition-none"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-slate-300 transition-transform motion-reduce:transition-none ${
            expanded ? 'rotate-90 text-slate-400' : ''
          }`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-slate-900">{entry.name}</span>
          <span className="text-[11px] text-slate-500">{accountKindLabel[entry.kind]}</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-3">
          {entry.items.map((item) => (
            <span key={item.type} className="text-right">
              <span className="block text-[11px] leading-none text-slate-400">
                {containerTypeLabel[item.type]}
              </span>
              <span className={`text-xl font-semibold tabular-nums leading-tight ${numTone}`}>
                {item.amount}
              </span>
            </span>
          ))}
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="divide-y divide-[var(--admin-line)] border-t border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-1 pl-11">
            {entry.items.map((item) => (
              <Derivation key={item.type} item={item} tone={tone} accountId={accountId} />
            ))}
          </div>
        </div>
      </div>
    </li>
  )
}

function LedgerColumn({
  tone,
  title,
  totals,
  entries,
  accountId,
  expanded,
  toggle,
}: {
  tone: 'rec' | 'pay'
  title: string
  totals: Record<ContainerType, number>
  entries: PartyEntry[]
  accountId: string
  expanded: Set<string>
  toggle: (key: string) => void
}) {
  const isRec = tone === 'rec'
  const Icon = isRec ? ArrowDownLeft : ArrowUpRight
  const accent = isRec ? 'text-[#1f6f68]' : 'text-rose-600'
  const totalPairs = (Object.keys(totals) as ContainerType[]).filter((t) => totals[t] > 0)
  return (
    <section
      className={`overflow-hidden rounded-xl border bg-white ${
        isRec ? 'border-[#2f8f87]/25' : 'border-rose-200'
      }`}
    >
      <header
        className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${
          isRec ? 'border-[#2f8f87]/20 bg-[#2f8f87]/[0.06]' : 'border-rose-100 bg-rose-50/70'
        }`}
      >
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${accent}`} aria-hidden strokeWidth={2} />
          <div>
            <h3 className={`text-sm font-semibold ${accent}`}>{title}</h3>
            <p className="text-[11px] text-slate-500">{entries.length} 个对手方</p>
          </div>
        </div>
        <div className="flex items-baseline gap-3">
          {totalPairs.length ? (
            totalPairs.map((t) => (
              <span key={t} className="text-right">
                <span className="block text-[11px] leading-none text-slate-400">
                  {containerTypeLabel[t]}
                </span>
                <span className={`text-lg font-semibold tabular-nums leading-tight ${accent}`}>
                  {totals[t]}
                </span>
              </span>
            ))
          ) : (
            <span className="text-sm text-slate-300">—</span>
          )}
        </div>
      </header>
      {entries.length ? (
        <ul className="divide-y divide-[var(--admin-line)]">
          {entries.map((entry) => {
            const key = `${tone}:${entry.id}`
            return (
              <PartyRow
                key={key}
                entry={entry}
                tone={tone}
                accountId={accountId}
                expanded={expanded.has(key)}
                onToggle={() => toggle(key)}
              />
            )
          })}
        </ul>
      ) : (
        <p className="px-4 py-10 text-center text-sm text-slate-400">
          {isRec ? '没有对方欠你的容器' : '你不欠任何对手方'}
        </p>
      )}
    </section>
  )
}

function PendingList({ pending }: { pending: Party[] }) {
  if (!pending.length) return null
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50">
      <header className="flex items-center gap-2 border-b border-amber-100 px-4 py-2.5">
        <Clock className="h-4 w-4 text-amber-600" aria-hidden strokeWidth={2} />
        <h3 className="text-sm font-medium text-amber-900">在途未确认</h3>
        <span className="text-[11px] text-amber-700">对方确认前不计入应收应付</span>
      </header>
      <ul className="divide-y divide-amber-100">
        {pending.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm text-slate-800">{p.name}</span>
              <span className="text-[11px] text-slate-500">{accountKindLabel[p.kind]}</span>
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-amber-800">
              {p.pendingOut ? `发出 ${p.pendingOut}` : ''}
              {p.pendingOut && p.pendingIn ? ' · ' : ''}
              {p.pendingIn ? `待收 ${p.pendingIn}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PanelSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-busy aria-label="对账数据载入中">
      <div className="h-72 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
      <div className="h-72 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />
    </div>
  )
}

export function ReconciliationPanel({ accounts }: Props) {
  const [picked, setPicked] = useState('')
  const [view, setView] = useState<ViewFilter>('open')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /**
   * 结果连同它属于哪个站点一起存：切换站点时旧站点的数字不会残留一帧。
   * 失败时存 data:null 结束 loading。
   */
  const [result, setResult] = useState<{ id: string; data: ReconciliationSummary | null } | null>(
    null,
  )

  const accountId = picked || accounts[0]?.id || ''
  const settled = result?.id === accountId
  const loading = accountId !== '' && !settled
  const data = settled ? result.data : null

  useEffect(() => {
    if (!accountId) return
    let alive = true
    setExpanded(new Set())
    void fetchReconciliation(accountId).then((res) => {
      if (!alive) return
      if (!res.ok) showToast(res.error, 'error')
      setResult({ id: accountId, data: res.ok ? res.data : null })
    })
    return () => {
      alive = false
    }
  }, [accountId])

  const grouped = useMemo(() => (data ? groupRows(data.rows) : null), [data])

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const openCount = grouped ? grouped.receivables.length + grouped.payables.length : 0
  const hasAnything =
    grouped &&
    (grouped.receivables.length ||
      grouped.payables.length ||
      grouped.pending.length ||
      grouped.settled.length)

  const emptyHint = !accounts.length
    ? '暂无可对账的站点，请先在「站点账户」建立站点。'
    : '与该站点还没有任何容器往来记录。'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-700">对账站点</span>
          <Select
            className="min-w-56"
            placeholder="选择…"
            showSearch
            optionFilterProp="label"
            value={accountId || undefined}
            disabled={accounts.length <= 1}
            onChange={setPicked}
            options={accounts.map((account) => ({ value: account.id, label: account.name }))}
          />
        </label>
        {grouped && grouped.settled.length ? (
          <Segmented
            value={view}
            onChange={(value) => setView(value as ViewFilter)}
            options={[
              { label: `未结清 ${openCount}`, value: 'open' },
              { label: `含已结清 ${openCount + grouped.settled.length}`, value: 'all' },
            ]}
          />
        ) : null}
      </div>

      {loading ? <PanelSkeleton /> : null}

      {!loading && grouped ? (
        hasAnything ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <LedgerColumn
                tone="rec"
                title="对方欠我 · 应收"
                totals={data!.owedToMe}
                entries={grouped.receivables}
                accountId={accountId}
                expanded={expanded}
                toggle={toggle}
              />
              <LedgerColumn
                tone="pay"
                title="我欠对方 · 应付"
                totals={data!.owedByMe}
                entries={grouped.payables}
                accountId={accountId}
                expanded={expanded}
                toggle={toggle}
              />
            </div>

            <PendingList pending={grouped.pending} />

            {view === 'all' && grouped.settled.length ? (
              <section className="rounded-xl border border-[var(--admin-line)] bg-white">
                <header className="border-b border-[var(--admin-line)] px-4 py-2.5">
                  <h3 className="text-sm font-medium text-slate-500">已结清</h3>
                </header>
                <ul className="divide-y divide-[var(--admin-line)]">
                  {grouped.settled.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-slate-700">{p.name}</span>
                        <span className="text-[11px] text-slate-400">{accountKindLabel[p.kind]}</span>
                      </span>
                      <span className="shrink-0 text-[13px] text-slate-400">两清</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <p className="text-xs text-slate-500">
              展开对手方可看「发出 − 收到 = 净额」的构成，数字可点进对应的已确认流转。
              只统计流转记录，不含盘点、报废；在途未确认不计入应收应付。
            </p>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-slate-500">{emptyHint}</p>
        )
      ) : null}

      {!loading && !grouped ? (
        <p className="py-10 text-center text-sm text-slate-500">
          {accountId ? '对账数据加载失败，请稍后重试。' : emptyHint}
        </p>
      ) : null}
    </div>
  )
}
