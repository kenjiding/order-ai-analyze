/**
 * 剪贴板写入（全站复用）。
 *
 * 优先 document.execCommand('copy')：在 Ant Design Drawer/Modal 焦点陷阱内更可靠；
 * Clipboard API 在部分环境下会 resolve 成功但实际未写入，导致「提示成功却粘贴不到」。
 * Vendor Daily Report 运单 Popover「复制所有」依赖的即是这条回退路径。
 */

function getCopyMountNode(): HTMLElement {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    const trap = active.closest('.ant-drawer-content, .ant-modal-content, [role="dialog"]')
    if (trap instanceof HTMLElement) return trap
  }
  const openDrawer = document.querySelector('.ant-drawer-open .ant-drawer-content')
  if (openDrawer instanceof HTMLElement) return openDrawer
  return document.body
}

function fallbackCopyText(text: string): boolean {
  const mount = getCopyMountNode()
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  // 必须可聚焦；放到当前焦点陷阱内，避免 Drawer 抢回焦点导致 copy 失败
  textarea.style.position = 'fixed'
  textarea.style.left = '0'
  textarea.style.top = '0'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.padding = '0'
  textarea.style.border = 'none'
  textarea.style.outline = 'none'
  textarea.style.opacity = '0'
  textarea.style.zIndex = '-1'
  mount.appendChild(textarea)

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)

  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }

  mount.removeChild(textarea)
  previous?.focus?.()
  return ok
}

/** 将文本写入系统剪贴板；成功 true，失败 false（不抛错） */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  // 同步路径优先，保留点击瞬间的用户激活，且避开 Clipboard API 假成功
  if (fallbackCopyText(text)) return true

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限拒绝 / 非安全上下文等
  }
  return false
}
