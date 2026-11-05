/**
 * 用 puppeteer-core 把一段静态 HTML 截图成 PNG（区域清货数据推送卡用）。
 * 用 puppeteer-core（不带内置 Chromium 下载）而不是 puppeteer：生产走 Alpine 容器，
 * 需要用 apk 装的系统 chromium，PUPPETEER_EXECUTABLE_PATH 指过去即可，见 Containerfile。
 * 本地 macOS 开发默认兜底本机 Chrome 路径，可用同一个 env 覆盖。
 */
import puppeteer from 'puppeteer-core'
import { envFirstOr } from '../imile/shared'

const DEFAULT_MAC_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function resolveExecutablePath(): string {
  return envFirstOr(['PUPPETEER_EXECUTABLE_PATH', 'CHROMIUM_EXECUTABLE_PATH'], DEFAULT_MAC_CHROME_PATH)
}

export async function renderHtmlToPngDataUrl(
  html: string,
  options?: { width?: number; deviceScaleFactor?: number; selector?: string },
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  try {
    browser = await puppeteer.launch({
      executablePath: resolveExecutablePath(),
      headless: true,
      // 容器内以非 root 跑（见 Containerfile USER app），Chromium sandbox 需要额外权限才能用，
      // 这里直接禁用；disable-dev-shm-usage 避免容器 /dev/shm 太小导致渲染崩溃。
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    })
    const page = await browser.newPage()
    await page.setViewport({
      width: options?.width ?? 900,
      height: 600,
      deviceScaleFactor: options?.deviceScaleFactor ?? 2,
    })
    await page.setContent(html, { waitUntil: 'load' })
    // setContent 的 load 事件不等网络字体加载完；没等到位会整张截图退回系统字体
    await page.evaluateHandle('document.fonts.ready')

    // 只截内容元素的实际包围盒（默认 .wrap），不截整页——避免页面背景/留白被一起截进去
    const selector = options?.selector ?? '.wrap'
    const el = await page.$(selector)
    if (!el) return { ok: false, error: `截图容器未找到(selector=${selector})` }
    const buf = await el.screenshot({ type: 'png' })
    return { ok: true, dataUrl: `data:image/png;base64,${Buffer.from(buf).toString('base64')}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (browser) await browser.close()
  }
}
