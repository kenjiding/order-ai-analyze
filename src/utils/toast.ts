import { message } from 'antd'
import type { ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

function dispatch(type: ToastType, content: ReactNode, duration: number) {
  const opts = { content, duration }
  switch (type) {
    case 'success':
      message.success(opts)
      break
    case 'error':
      message.error(opts)
      break
    case 'warning':
      message.warning(opts)
      break
    case 'info':
      message.info(opts)
      break
  }
}

/** Ant Design 全局 toast（message API） */
export function showToast(
  text: ReactNode,
  type: ToastType = 'success',
  duration = type === 'error' ? 5 : 3
) {
  dispatch(type, text, duration)
}

/** 兼容原 MessageBanner / onBanner 的 { type, text } 形态 */
export function showBannerToast(msg: { text: string; type: string } | null | undefined) {
  if (!msg?.text) return
  const type: ToastType =
    msg.type === 'error' || msg.type === 'err'
      ? 'error'
      : msg.type === 'warning'
        ? 'warning'
        : 'success'
  showToast(msg.text, type)
}
