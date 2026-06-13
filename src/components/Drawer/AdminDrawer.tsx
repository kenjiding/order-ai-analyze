import { Drawer, type DrawerProps } from 'antd'
import { type CSSProperties, type ReactNode } from 'react'
import { DrawerCloseButton } from './DrawerCloseButton'

export type AdminDrawerProps = Omit<DrawerProps, 'closable' | 'title' | 'onClose'> & {
  open: boolean
  onClose: () => void
  title: ReactNode
  eyebrow?: ReactNode
  subtitle?: ReactNode
  closeAriaLabel?: string
}

const defaultHeaderStyle: CSSProperties = {
  padding: '20px 24px 16px',
  borderBottom: '1px solid #e2e8f0',
}

export function AdminDrawer({
  open,
  onClose,
  title,
  eyebrow,
  subtitle,
  closeAriaLabel,
  className,
  styles,
  ...rest
}: AdminDrawerProps) {
  const mergedStyles: DrawerProps['styles'] =
    typeof styles === 'function'
      ? (info) => {
          const resolved = styles(info)
          return {
            ...resolved,
            header: { ...defaultHeaderStyle, ...resolved?.header },
          }
        }
      : {
          ...styles,
          header: { ...defaultHeaderStyle, ...styles?.header },
        }

  return (
    <Drawer
      {...rest}
      open={open}
      onClose={onClose}
      closable={false}
      className={['admin-drawer', className].filter(Boolean).join(' ')}
      title={
        <div className="flex w-full items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{eyebrow}</div>
            ) : null}
            <div className={eyebrow ? 'mt-1 text-lg font-semibold tracking-tight text-slate-950' : 'text-lg font-semibold tracking-tight text-slate-950'}>
              {title}
            </div>
            {subtitle ? <p className="mt-1 text-sm font-normal leading-relaxed text-slate-500">{subtitle}</p> : null}
          </div>
          <DrawerCloseButton onClick={onClose} aria-label={closeAriaLabel} className="mt-0.5" />
        </div>
      }
      styles={mergedStyles}
    />
  )
}
