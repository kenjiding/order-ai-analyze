import { App } from 'antd'
import type { MessageInstance } from 'antd/es/message/interface'
import { useLayoutEffect, type ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

let messageApi: MessageInstance | null = null

export function registerMessageApi(api: MessageInstance) {
  messageApi = api
}

/** 挂载于 `<App>` 内，将 context-aware message API 注入 showToast */
export function ToastBridge() {
  const { message } = App.useApp()
  useLayoutEffect(() => {
    registerMessageApi(message)
  }, [message])
  return null
}

function dispatch(type: ToastType, content: ReactNode, duration: number) {
  if (!messageApi) return
  const opts = { content, duration }
  switch (type) {
    case 'success':
      messageApi.success(opts)
      break
    case 'error':
      messageApi.error(opts)
      break
    case 'warning':
      messageApi.warning(opts)
      break
    case 'info':
      messageApi.info(opts)
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
