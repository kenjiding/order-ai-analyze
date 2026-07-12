import { Grid } from 'antd'

const { useBreakpoint } = Grid

/** md 断点（768px）以下视为移动端，与 Tailwind 的 `md:` 断点保持一致 */
export function useIsMobile(): boolean {
  const screens = useBreakpoint()
  return !screens.md
}
