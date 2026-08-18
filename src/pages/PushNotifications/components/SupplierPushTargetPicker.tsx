import { Tooltip } from 'antd'
import { AtSign, Check, MessageSquare, Route } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { hasEditorContent } from '../../../components/FeishuLarkMdEditor'
import type { FleetSupplierConfig } from '../fleetSupplierPushTypes'
import { supplierDisplayName } from '../fleetSupplierPushTypes'
import { isSupplierPushEligible, truncateSupplierFieldMid } from '../../../shared/supplierPushConfig'

type Props = {
  /** 已按关键字过滤后的供应商 */
  configs: FleetSupplierConfig[]
  selectedIds: ReadonlySet<string>
  chatNameById: Map<string, string>
  loading: boolean
  onToggle: (configId: string) => void
  emptyText: ReactNode
}

function mentionLabel(contacts: FleetSupplierConfig['mentionOpenIds'] | undefined): string {
  const list = contacts ?? []
  const names = list.map((c) => c.name.trim()).filter(Boolean)
  if (names.length > 0) return names.join('、')
  if (list.length > 0) return `${list.length} 人`
  return ''
}

/**
 * 推送对象选择：磁贴多选，一屏内尽量多地展示「谁会收到、发到哪个群、@ 谁、有没有专属文案」。
 * 只读展示，不承担配置维护；未配置 webhook / chatId 的供应商不可选并标注原因。
 */
export function SupplierPushTargetPicker({
  configs,
  selectedIds,
  chatNameById,
  loading,
  onToggle,
  emptyText,
}: Props) {
  if (loading) {
    return (
      <div className="fs-target-grid" aria-busy>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="fs-target-skeleton" />
        ))}
      </div>
    )
  }

  if (configs.length === 0) {
    return <div className="fs-target-empty">{emptyText}</div>
  }

  return (
    <div className="fs-target-grid" role="group" aria-label="推送对象">
      {configs.map((c) => {
        const eligible = isSupplierPushEligible(c)
        const selected = selectedIds.has(c.id)
        const chatId = c.chatId?.trim() ?? ''
        const chatName = chatId ? chatNameById.get(chatId)?.trim() : ''
        const target = chatName || (chatId ? truncateSupplierFieldMid(chatId, 18) : '') || (c.webhookUrl.trim() ? '群机器人 webhook' : '')
        const mentions = mentionLabel(c.mentionOpenIds)
        const route = c.routeCode.trim()
        const station = c.stationCode?.trim() ?? ''
        const ownContent = hasEditorContent(c.pushContent)

        const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key !== ' ' && e.key !== 'Enter') return
          e.preventDefault()
          if (eligible) onToggle(c.id)
        }

        const card = (
          <div
            role="checkbox"
            aria-checked={selected}
            aria-disabled={!eligible}
            tabIndex={eligible ? 0 : -1}
            onClick={() => eligible && onToggle(c.id)}
            onKeyDown={onKeyDown}
            className={[
              'fs-target-card',
              selected ? 'is-selected' : '',
              eligible ? '' : 'is-disabled',
            ].filter(Boolean).join(' ')}
          >
            <div className="fs-target-head">
              <span className="fs-target-name" title={supplierDisplayName(c)}>
                {supplierDisplayName(c)}
              </span>
              <span className="fs-target-mark" aria-hidden>
                {selected ? <Check className="h-3 w-3" /> : null}
              </span>
            </div>

            <div className="fs-target-sub" title={`${c.vendorName || '未知供应商'} ${c.vendorCode}`}>
              <span className="truncate">{c.vendorName || '未知供应商'}</span>
              <span className="fs-target-code">{c.vendorCode || '无编码'}</span>
            </div>

            <div className="fs-target-chips">
              {route ? (
                <span className="fs-target-chip" title={`路由编码 ${route}`}>
                  <Route className="h-3 w-3" aria-hidden />
                  {truncateSupplierFieldMid(route, 16)}
                </span>
              ) : (
                <span className="fs-target-chip is-muted">无路由</span>
              )}
              {station ? <span className="fs-target-chip">站点 {station}</span> : null}
              {ownContent ? <span className="fs-target-chip is-accent">专属文案</span> : null}
              {!eligible ? <span className="fs-target-chip is-warn">无推送目标</span> : null}
            </div>

            <div className="fs-target-foot">
              <span className="fs-target-foot-item" title={chatName ? `飞书群：${chatName}` : chatId || c.webhookUrl}>
                <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{target || '未配置'}</span>
              </span>
              {mentions ? (
                <span className="fs-target-foot-item" title={`@ ${mentions}`}>
                  <AtSign className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{mentions}</span>
                </span>
              ) : null}
            </div>
          </div>
        )

        if (eligible) return <div key={c.id}>{card}</div>

        return (
          <Tooltip key={c.id} title="未配置 webhook 或飞书群 Chat ID，无法推送；请到「系统管理 → 供应商配置」补全">
            <div>{card}</div>
          </Tooltip>
        )
      })}
    </div>
  )
}
