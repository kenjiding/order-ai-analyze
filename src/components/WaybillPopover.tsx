import { App as AntdApp, Button, Popover } from 'antd'
import { Copy } from 'lucide-react'
import type React from 'react'

const MAX_NOS = 50

type Placement = 'bottom' | 'bottomLeft' | 'bottomRight' | 'top' | 'topLeft' | 'topRight' | 'left' | 'right'

function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)
  return ok
}

async function copyAllNos(nos: string[]): Promise<boolean> {
  const text = nos.join('\n')
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to execCommand
  }
  return fallbackCopyText(text)
}

function PopoverContent({ nos, title }: { nos: string[]; title: string }) {
  const { message } = AntdApp.useApp()
  const displayed = nos.slice(0, MAX_NOS)

  const handleCopyAll = async (event: React.MouseEvent) => {
    event.stopPropagation()
    const ok = await copyAllNos(nos)
    if (ok) {
      message.success(`已复制 ${nos.length} 条单号`)
    } else {
      message.error('复制失败，请手动复制')
    }
  }

  return (
    <div style={{ width: 240 }}>
      {/* 标题行 */}
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
            复制所有
          </Button>
          <span style={{
            fontSize: 10.5, fontWeight: 600,
            background: '#fff7ed', color: '#c2410c',
            padding: '1px 8px', borderRadius: 20, whiteSpace: 'nowrap',
          }}>共 {nos.length} 件</span>
        </div>
      </div>
      {/* 单号列表 */}
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
          }}>…仅显示前 {MAX_NOS} 件，共 {nos.length} 件</div>
        )}
      </div>
    </div>
  )
}

/**
 * 通用运单号列表 Popover：hover 子节点时弹出单号面板。
 * nos 为空时直接透传 children，不渲染 Popover 逻辑。
 */
export function WaybillListPopover({
  nos,
  title = '单号列表',
  placement = 'bottomLeft',
  children,
}: {
  nos: string[]
  title?: string
  placement?: Placement
  children: React.ReactElement
}) {
  if (nos.length === 0) return children
  return (
    <Popover
      content={<PopoverContent nos={nos} title={title} />}
      trigger="hover"
      placement={placement}
      overlayInnerStyle={{ padding: 12, borderRadius: 8 }}
      overlayStyle={{ zIndex: 1080 }}
    >
      {children}
    </Popover>
  )
}

/**
 * 未达标数量触发器：渲染一个红色带虚线下划线的计数文本，hover 展示单号列表。
 * - nos 有数据时带 Popover
 * - nos 为空时仍显示计数，但无 Popover 效果
 * - count === 0 时返回 null
 */
export function UnmetTrigger({
  count,
  nos,
  title,
  unit = '件未达标',
}: {
  count: number
  nos: string[]
  title: string
  unit?: string
}) {
  if (count === 0) return null
  const hasNos = nos.length > 0
  const trigger = (
    <span style={{
      fontSize: 11, fontWeight: 600, color: '#dc2626', lineHeight: 1.4,
      cursor: hasNos ? 'help' : 'default',
      borderBottom: hasNos ? '1px dashed #fca5a5' : 'none',
      display: 'inline-block',
    }}>
      {count} {unit}
    </span>
  )
  if (!hasNos) return trigger
  return (
    <WaybillListPopover nos={nos} title={title} placement="bottomLeft">
      {trigger}
    </WaybillListPopover>
  )
}
