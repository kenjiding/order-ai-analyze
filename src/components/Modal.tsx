import { useEffect, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type ModalProps = {
  isOpen: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  maxWidth?: string
  showCloseButton?: boolean
  closeOnClickOutside?: boolean
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-2xl',
  showCloseButton = true,
  closeOnClickOutside = true,
}: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (closeOnClickOutside && e.target === e.currentTarget) {
      onClose()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-400/30 p-4 backdrop-blur-sm"
      style={{ position: 'fixed', overflow: 'hidden' }}
      onClick={handleBackdropClick}
    >
      <div className={`flex max-h-[90vh] w-full flex-col rounded-lg bg-white shadow-2xl ${maxWidth}`}>
        {title && (
          <div className="flex-shrink-0 rounded-t-lg border-b border-slate-200 bg-slate-50 px-6 py-4">
            <div className="flex items-center justify-between">
              {typeof title === 'string' ? (
                <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
              ) : (
                title
              )}
              {showCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer && <div className="flex-shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
