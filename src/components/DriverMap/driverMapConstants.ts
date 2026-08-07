/** 阿德莱德市中心，地图默认视图定位点 */
export const ADELAIDE_CENTER = { lat: -34.9285, lng: 138.6007 }
export const DEFAULT_MAP_ZOOM = 12

/** 签收 / 未签收 / 问题件 配色 */
export const STATUS_COLORS = {
  completed: '#16a34a',
  pending: '#f59e0b',
  problem: '#dc2626',
} as const

export const STATUS_LABELS = {
  completed: '签收',
  pending: '未签收',
  problem: '问题件',
} as const

/** 不同司机轨迹连线配色（按 courierCode 稳定哈希取色） */
export const DRIVER_TRAIL_COLORS = [
  '#2563eb', // blue
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#db2777', // pink
  '#ea580c', // orange
  '#059669', // emerald
  '#4f46e5', // indigo
  '#ca8a04', // yellow
  '#0d9488', // teal
  '#e11d48', // rose
] as const

export function trailColorForDriver(courierCode: string): string {
  const key = courierCode.trim() || 'unknown'
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return DRIVER_TRAIL_COLORS[hash % DRIVER_TRAIL_COLORS.length]!
}

/**
 * 地图标点：圆圈样式；签收/问题件带大号顺序数字，未签收不加号。
 * `pixelRatio` 只放大 svg 的 width/height（栅格化的像素密度），viewBox 和内部坐标不变——
 * 保证视觉大小不变的前提下在高分屏（devicePixelRatio>1）下不糊。
 */
export function buildStatusPinIconUrl(
  status: keyof typeof STATUS_COLORS,
  sequence?: number,
  pixelRatio = 1,
): string {
  const fill = STATUS_COLORS[status]
  const label =
    typeof sequence === 'number' && sequence > 0
      ? String(sequence > 999 ? '999+' : sequence)
      : ''
  const fontSize = label.length >= 3 ? 13 : label.length === 2 ? 16 : 20

  // 未签收：空心圆环，无数字
  if (status === 'pending') {
    const size = 32 * pixelRatio
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="12" fill="${fill}" fill-opacity="0.2" stroke="${fill}" stroke-width="3"/>
      <circle cx="16" cy="16" r="4" fill="${fill}"/>
    </svg>`
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  }

  // 签收 / 问题件：实心圆 + 大号白色数字（水平/垂直居中；SVG 作图片时用 dy 比 dominant-baseline 更稳）
  // 描边故意做细（1px）：地图缩小、大量点位彼此靠近堆叠时，粗描边会叠成一片片白色色块
  const size = 36 * pixelRatio
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="16" fill="${fill}" stroke="#ffffff" stroke-width="1"/>
    ${
      label
        ? `<text x="18" y="18" dy="0.38em" text-anchor="middle" fill="#ffffff" font-size="${fontSize}" font-family="Arial,Helvetica,sans-serif" font-weight="800">${label}</text>`
        : ''
    }
  </svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}
