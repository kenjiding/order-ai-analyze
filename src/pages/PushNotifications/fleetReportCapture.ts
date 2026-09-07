import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { toJpeg } from 'html-to-image'
import { i18n } from '../../i18n/index'
import { FEISHU_PUSH_CAPTURE_PIXEL_RATIO, FEISHU_PUSH_JPEG_QUALITY } from '../../utils/feishuScreenshotImageSettings'
import { FleetPivotReportView } from './components/FleetPivotReportView'
import type { FleetRouteBucket } from './fleetSupplierPushTypes'

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
 * 用与页面预览相同的 React 报表组件离屏渲染，导出 JPEG data URL（html-to-image）。
 */
export async function captureFleetRouteReportPng(params: {
  title: string
  subtitle?: string
  buckets: FleetRouteBucket[]
}): Promise<string> {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.zIndex = '-1'
  document.body.appendChild(host)

  let root: Root | null = null
  try {
    root = createRoot(host)
    flushSync(() => {
      root!.render(
        createElement(FleetPivotReportView, {
          title: params.title,
          subtitle: params.subtitle,
          buckets: params.buckets,
          showNote: true,
        }),
      )
    })
    await waitFrames(2)
    const el = host.querySelector<HTMLElement>('.fleet-pivot-report-view')
    if (!el) {
      throw new Error(String(i18n.t('fleetTab.reportNotMounted', { ns: 'pushNotifications' })))
    }
    const width = Math.max(el.scrollWidth, el.clientWidth, 1)
    const height = Math.max(el.scrollHeight, el.clientHeight, 1)
    return await toJpeg(el, {
      cacheBust: true,
      backgroundColor: '#ffffff',
      width,
      height,
      pixelRatio: FEISHU_PUSH_CAPTURE_PIXEL_RATIO,
      quality: FEISHU_PUSH_JPEG_QUALITY,
      style: { overflow: 'visible' },
      fontEmbedCSS: '',
    })
  } finally {
    root?.unmount()
    document.body.removeChild(host)
  }
}
