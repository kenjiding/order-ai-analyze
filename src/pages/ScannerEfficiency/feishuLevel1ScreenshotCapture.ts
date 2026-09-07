import { toJpeg } from 'html-to-image'
import { FEISHU_PUSH_CAPTURE_PIXEL_RATIO, FEISHU_PUSH_JPEG_QUALITY } from '../../utils/feishuScreenshotImageSettings'
import { i18n } from '../../i18n/index'

/** 挂载此属性的元素及其子树在飞书推送截图克隆时会被跳过（例：推送按钮）。 */
export const SKIP_FEISHU_CAPTURE_ATTR = 'data-feishu-capture-ignore'

type StyleSnapshot = { el: HTMLElement; maxHeight: string; overflow: string; overflowX: string; overflowY: string }

/** 抓拍前临时展开 bounded 表格滚动区，完成后还原，避免纵向滚动裁剪。 */
function relaxBoundedTablesInSubtree(root: HTMLElement): () => void {
  const nodes = root.querySelectorAll('.data-table--bounded, .scanner-efficiency-antd-table--bounded .ant-table-body')
  const snaps: StyleSnapshot[] = []
  nodes.forEach((node) => {
    const el = node as HTMLElement
    snaps.push({
      el,
      maxHeight: el.style.maxHeight,
      overflow: el.style.overflow,
      overflowX: el.style.overflowX,
      overflowY: el.style.overflowY,
    })
    el.style.maxHeight = 'none'
    el.style.overflow = 'visible'
    el.style.overflowX = 'visible'
    el.style.overflowY = 'visible'
  })
  return () => {
    snaps.forEach(({ el, maxHeight, overflow, overflowX, overflowY }) => {
      el.style.maxHeight = maxHeight
      el.style.overflow = overflow
      el.style.overflowX = overflowX
      el.style.overflowY = overflowY
    })
  }
}

function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let k = n
    const step = (): void => {
      if (k <= 0) {
        resolve()
        return
      }
      k -= 1
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

/**
 * 将多张图片 data URL（JPEG/PNG 等）垂直拼接为一张图（宽度取最大值，各图居左对齐）。
 * 用于把效率明细/天（表）、效率明细/天（图）、扫描员汇总合并后再推送。
 */
export async function mergeImagesVertically(dataUrls: string[]): Promise<string> {
  if (!dataUrls.length) throw new Error(String(i18n.t('capture.noImages', { ns: 'scannerEfficiency' })))
  if (dataUrls.length === 1) return dataUrls[0]

  const images = await Promise.all(
    dataUrls.map(
      (url) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error(String(i18n.t('capture.imageLoadFailed', { ns: 'scannerEfficiency' }))))
          img.src = url
        }),
    ),
  )

  const maxWidth = Math.max(...images.map((img) => img.width))
  const totalHeight = images.reduce((sum, img) => sum + img.height, 0)

  const canvas = document.createElement('canvas')
  canvas.width = maxWidth
  canvas.height = totalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(String(i18n.t('capture.noCanvas', { ns: 'scannerEfficiency' })))
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, maxWidth, totalHeight)

  let y = 0
  for (const img of images) {
    ctx.drawImage(img, 0, y, img.width, img.height)
    y += img.height
  }

  return canvas.toDataURL('image/jpeg', FEISHU_PUSH_JPEG_QUALITY)
}

/** 将对账截图渲染为 JPEG data URL（供飞书 webhook 后端上载）。 */
export async function captureScannerPushRegion(root: HTMLElement | null): Promise<string> {
  if (!root) throw new Error(String(i18n.t('capture.regionNotReady', { ns: 'scannerEfficiency' })))
  const restoreTables = relaxBoundedTablesInSubtree(root)
  await waitFrames(2)
  try {
    const width = Math.max(root.scrollWidth, root.clientWidth, 1)
    const height = Math.max(root.scrollHeight, root.clientHeight, 1)
    return await toJpeg(root, {
      cacheBust: true,
      backgroundColor: '#ffffff',
      width,
      height,
      pixelRatio: FEISHU_PUSH_CAPTURE_PIXEL_RATIO,
      quality: FEISHU_PUSH_JPEG_QUALITY,
      /**
       * 推送截图容器平时会通过 transform 移出视口；抓拍时要临时归位，
       * 否则渲染结果可能整体偏到画布外侧，出现“空白图”。
       */
      style: { overflow: 'visible', transform: 'none', left: '0', top: '0' },
      /**
       * 避免读取跨域字体样式表（如 fonts.googleapis.com）触发 SecurityError；
       * 抓拍允许退回系统字体，不影响数据可读性。
       */
      fontEmbedCSS: '',
      filter: (domNode: HTMLElement) => {
        /** html-to-image 会遍历 childNodes，含 `#text` 等非 Element，无 `hasAttribute` */
        if (!(domNode instanceof Element)) return true
        return !domNode.hasAttribute(SKIP_FEISHU_CAPTURE_ATTR)
      },
    })
  } finally {
    restoreTables()
  }
}
