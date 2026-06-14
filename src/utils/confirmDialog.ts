import { Modal } from 'antd'
import type { ReactNode } from 'react'

export type ConfirmDialogOptions = {
  title: string
  content?: ReactNode
  okText?: string
  cancelText?: string
  /** 破坏性操作（删除、禁用、放弃修改等） */
  danger?: boolean
}

/** 替代 window.confirm，使用 Ant Design Modal.confirm */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: options.title,
      content: options.content,
      okText: options.okText ?? '确定',
      cancelText: options.cancelText ?? '取消',
      centered: true,
      okButtonProps: options.danger ? { danger: true } : undefined,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

/** 替代 window.alert，使用 Ant Design Modal.info（仅通知、无后续操作） */
export function alertDialog(title: string, content?: ReactNode): Promise<void> {
  return new Promise((resolve) => {
    Modal.info({
      title,
      content,
      okText: '知道了',
      centered: true,
      onOk: () => resolve(),
    })
  })
}
