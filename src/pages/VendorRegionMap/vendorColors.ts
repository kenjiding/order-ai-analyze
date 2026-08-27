/**
 * 高对比分类色：相邻色相拉开，避免蓝/紫、橙/红在地图上糊在一起。
 * 按供应商列表顺序分配，不用 hash，保证前几家一定两两可辨。
 */
const VENDOR_PALETTE = [
  '#E11D48', // 玫红
  '#2563EB', // 蓝
  '#16A34A', // 绿
  '#EA580C', // 橙
  '#7C3AED', // 紫
  '#0891B2', // 青
  '#CA8A04', // 金
  '#BE185D', // 品红
  '#1E3A8A', // 藏青
  '#65A30D', // 黄绿
  '#9A3412', // 棕
  '#0F766E', // 深青
  '#C026D3', // 亮紫
  '#B45309', // 琥珀
  '#4338CA', // 靛
  '#B91C1C', // 深红
] as const

const UNMATCHED_SUPPLIER_KEY = '__unmatched__'
const UNMATCHED_COLOR = '#64748b'

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function fallbackColor(index: number): string {
  const hue = (index * 137.508) % 360
  return hslToHex(hue, 78, index % 2 === 0 ? 38 : 50)
}

export function buildVendorColorMap(supplierKeys: readonly string[]): Map<string, string> {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of supplierKeys) {
    const code = raw.trim()
    if (!code || seen.has(code)) continue
    seen.add(code)
    unique.push(code)
  }
  const map = new Map<string, string>()
  let paletteIndex = 0
  for (const code of unique) {
    if (code === UNMATCHED_SUPPLIER_KEY) {
      map.set(code, UNMATCHED_COLOR)
      continue
    }
    map.set(code, VENDOR_PALETTE[paletteIndex] ?? fallbackColor(paletteIndex))
    paletteIndex += 1
  }
  return map
}

export function colorFromMap(colorMap: Map<string, string>, supplierKey: string): string {
  const key = supplierKey.trim()
  if (key === UNMATCHED_SUPPLIER_KEY) return colorMap.get(key) ?? UNMATCHED_COLOR
  return colorMap.get(key) ?? '#334155'
}
