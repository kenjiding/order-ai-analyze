import { Tooltip } from 'antd'
import { AtSign, Check, MessageSquare, Route } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('pushNotifications')
  const listSep = t('common.listSeparator')

  const mentionLabel = (contacts: FleetSupplierConfig['mentionOpenIds'] | undefined): string => {
    const list = contacts ?? []
    const names = list.map((c) => c.name.trim()).filter(Boolean)
    if (names.length > 0) return names.join(listSep)
    if (list.length > 0) return t('fleetTarget.mentionPeople', { count: list.length })
    return ''
  }

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
    <div className="fs-target-grid" role="group" aria-label={t('fleetTarget.ariaLabel')}>
      {configs.map((c) => {
        const eligible = isSupplierPushEligible(c)
        const selected = selectedIds.has(c.id)
        const chatId = c.chatId?.trim() ?? ''
        const chatName = chatId ? chatNameById.get(chatId)?.trim() : ''
        const target =
          chatName ||
          (chatId ? truncateSupplierFieldMid(chatId, 18) : '') ||
          (c.webhookUrl.trim() ? t('fleetTarget.groupBotWebhook') : '')
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

            <div className="fs-target-sub" title={`${c.vendorName || t('fleetTarget.unknownVendor')} ${c.vendorCode}`}>
              <span className="truncate">{c.vendorName || t('fleetTarget.unknownVendor')}</span>
              <span className="fs-target-code">{c.vendorCode || t('fleetTarget.noCode')}</span>
            </div>

            <div className="fs-target-chips">
              {route ? (
                <span className="fs-target-chip" title={t('fleetTarget.routeCodeTitle', { route })}>
                  <Route className="h-3 w-3" aria-hidden />
                  {truncateSupplierFieldMid(route, 16)}
                </span>
              ) : (
                <span className="fs-target-chip is-muted">{t('fleetTarget.noRoute')}</span>
              )}
              {station ? (
                <span className="fs-target-chip">{t('fleetTarget.station', { code: station })}</span>
              ) : null}
              {ownContent ? <span className="fs-target-chip is-accent">{t('fleetTarget.customCopy')}</span> : null}
              {!eligible ? <span className="fs-target-chip is-warn">{t('fleetTarget.noPushTarget')}</span> : null}
            </div>

            <div className="fs-target-foot">
              <span
                className="fs-target-foot-item"
                title={
                  chatName
                    ? t('fleetTarget.feishuGroupTitle', { name: chatName })
                    : chatId || c.webhookUrl
                }
              >
                <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{target || t('fleetTarget.notConfigured')}</span>
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
          <Tooltip key={c.id} title={t('fleetTarget.ineligibleTooltip')}>
            <div>{card}</div>
          </Tooltip>
        )
      })}
    </div>
  )
}
