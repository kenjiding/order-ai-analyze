import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { i18n } from './index'

/** 挂载 i18n 实例；init 在 ./index 侧效中完成，此处仅提供 Provider 边界 */
export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
