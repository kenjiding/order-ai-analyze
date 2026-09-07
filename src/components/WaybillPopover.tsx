import { App as AntdApp, Button, Popover } from 'antd'
import { Copy } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { copyTextToClipboard } from '../utils/clipboard'

const MAX_NOS = 50

type Placement = 'bottom' | 'bottomLeft' | 'bottomRight' | 'top' | 'topLeft' | 'topRight' | 'left' | 'right'

function PopoverContent({ nos, title }: { nos: string[]; title: string }) {
  const { message } = AntdApp.useApp()
  const { t } = useTranslation('common')
  const displayed = nos.slice(0, MAX_NOS)

  const handleCopyAll = async (event: React.MouseEvent) => {
    event.stopPropagation()
    const ok = await copyTextToClipboard(nos.join('\n'))
    if (ok) {
      message.success(t('copiedWaybills', { count: nos.length }))
    } else {
      message.error(t('copyFailed'))
    }
  }

  return (
    <div style={{ width: 240 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        background: '#fafafa', margin: '-12px -12px 0',
        padding: '9px 12px', borderBottom: '1px solid #f0f0f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: 1 }}>
          <span style={{
            width: 3, height: 13, borderRadius: 2,
            background: '#f97316', flexShrink: 0, display: 'inline-block',
          }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Button
            type="link"
            className="!px-1 !h-auto !text-[11px]"
            icon={<Copy className="h-3 w-3" />}
            onClick={(event) => void handleCopyAll(event)}
          >
            {t('copyAll')}
          </Button>
          <span style={{
            fontSize: 10.5, fontWeight: 600,
            background: '#fff7ed', color: '#c2410c',
            padding: '1px 8px', borderRadius: 20, whiteSpace: 'nowrap',
          }}>{t('totalParcels', { count: nos.length })}</span>
        </div>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto', padding: '5px 0 3px', margin: '0 -12px' }}>
        {displayed.map((no) => (
          <div key={no} style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12, color: '#1e293b',
            padding: '3px 12px', lineHeight: 1.65,
          }}>{no}</div>
        ))}
        {nos.length > MAX_NOS && (
          <div style={{
            fontSize: 10.5, color: '#94a3b8', textAlign: 'center',
            padding: '4px 12px 2px',
            borderTop: '1px solid #f5f5f5', marginTop: 2,
          }}>{t('showFirstNOfTotal', { max: MAX_NOS, total: nos.length })}</div>
        )}
      </div>
    </div>
  )
}

export function WaybillListPopover({
  nos,
  title,
  placement = 'bottomLeft',
  children,
}: {
  nos: string[]
  title?: string
  placement?: Placement
  children: React.ReactElement
}) {
  const { t } = useTranslation('common')
  const resolvedTitle = title ?? t('waybillList')
  if (nos.length === 0) return children
  return (
    <Popover
      content={<PopoverContent nos={nos} title={resolvedTitle} />}
      trigger="hover"
      placement={placement}
      overlayInnerStyle={{ padding: 12, borderRadius: 8 }}
      overlayStyle={{ zIndex: 1080 }}
    >
      {children}
    </Popover>
  )
}

export function UnmetTrigger({
  count,
  nos,
  title,
  unit,
}: {
  count: number
  nos: string[]
  title: string
  unit?: string
}) {
  const { t } = useTranslation('vendorAnalysis')
  if (count === 0) return null
  const label = unit ?? t('kpi.unmetTickets', { count })
  const hasNos = nos.length > 0
  const trigger = (
    <span style={{
      fontSize: 11, fontWeight: 600, color: '#dc2626', lineHeight: 1.4,
      cursor: hasNos ? 'help' : 'default',
      borderBottom: hasNos ? '1px dashed #fca5a5' : 'none',
      display: 'inline-block',
    }}>
      {label}
    </span>
  )
  if (!hasNos) return trigger
  return (
    <WaybillListPopover nos={nos} title={title} placement="bottomLeft">
      {trigger}
    </WaybillListPopover>
  )
}
