/** 库内丢包各图共用的分类色板：同名类目在桑基图与柱状图取同一颜色。 */
const CATEGORY_COLORS = [
  '#1f6f68',
  '#d97706',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#0f766e',
  '#ea580c',
  '#0284c7',
  '#4d7c0f',
  '#9333ea',
  '#b45309',
  '#0e7490',
]

/** 未标注供应商 / 未标注路由 / 未标注嫌疑派件员等统一取灰色 */
export const UNLABELED_COLOR = '#94a3b8'

function isUnlabeled(key: string): boolean {
  return key.startsWith('未标注')
}

/** 按传入顺序分配颜色；未标注类目不占用色板位次。 */
export function categoryColorMap(keys: readonly string[]): Map<string, string> {
  const colors = new Map<string, string>()
  let index = 0
  for (const key of keys) {
    if (colors.has(key)) continue
    if (isUnlabeled(key)) {
      colors.set(key, UNLABELED_COLOR)
      continue
    }
    colors.set(key, CATEGORY_COLORS[index % CATEGORY_COLORS.length])
    index += 1
  }
  return colors
}
