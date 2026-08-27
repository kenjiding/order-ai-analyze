import { useEffect, useRef, useState } from 'react'
import { BarcodeDetector, prepareZXingModule, type BarcodeFormat } from 'barcode-detector/ponyfill'
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { CircleCheck, Loader2, TriangleAlert, X } from 'lucide-react'

/**
 * 一律走 zxing-wasm 的 ponyfill，不用浏览器原生 BarcodeDetector：
 * 原生的只有 Android Chrome 有，而现场手机全是 iPhone；安卓 PDA 自带硬件扫描头也不走摄像头。
 * 统一一条代码路径，识别行为在所有机型上一致。
 */

/**
 * zxing-wasm 默认从 jsDelivr CDN 拉 .wasm，仓库内网或 CDN 不通就整个哑掉。
 * 改成 Vite 打进 dist/assets 的同源地址，跟着前端一起部署。
 */
const WASM_OVERRIDES = {
  locateFile: (path: string, prefix: string) =>
    path.endsWith('.wasm') ? zxingWasmUrl : `${prefix}${path}`,
}

/** 只认一维码：面单上通常还印着别的二维码，开了容易误读到不相干的内容 */
const WANTED_FORMATS: BarcodeFormat[] = [
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'ean_13',
  'ean_8',
  'itf',
  'upc_a',
  'upc_e',
]

const DETECT_INTERVAL_MS = 250
/** 同一个码在镜头里会连续命中很多帧，冷却期内不重复入列 */
const SAME_VALUE_COOLDOWN_MS = 1500
const FEEDBACK_VISIBLE_MS = 1600

export type CameraDetectOutcome = 'added' | 'duplicate' | 'empty'

function describeCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '摄像头权限被拒绝，请在浏览器设置里允许本站使用摄像头后重试'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '没有找到可用的后置摄像头'
  }
  if (name === 'NotReadableError') {
    return '摄像头被其它程序占用，请关掉后重试'
  }
  return err instanceof Error ? err.message : '摄像头启动失败'
}

/**
 * 全屏取景框，连续识别一维条码。
 * 识别成功不自动关闭，方便连续扫多个包裹；父级负责入列与去重。
 */
export function CameraScanner({
  merchantLabel,
  onDetect,
  onClose,
}: {
  merchantLabel: string
  onDetect: (scanNumber: string) => CameraDetectOutcome
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // 识别循环跑在 effect 里，闭包会锁住首帧的 onDetect；用 ref 始终指向最新一次渲染的回调
  const onDetectRef = useRef(onDetect)
  const lastValueRef = useRef<{ value: string; at: number } | null>(null)

  const [status, setStatus] = useState('正在启动摄像头...')
  const [error, setError] = useState('')
  const [addedCount, setAddedCount] = useState(0)
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    onDetectRef.current = onDetect
  })

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null
    let detectTimer: number | undefined
    let feedbackTimer: number | undefined

    const showFeedback = (text: string, ok: boolean) => {
      setFeedback({ text, ok })
      if (feedbackTimer) window.clearTimeout(feedbackTimer)
      feedbackTimer = window.setTimeout(() => setFeedback(null), FEEDBACK_VISIBLE_MS)
    }

    const fail = (message: string) => {
      if (cancelled) return
      setError(message)
      setStatus('')
    }

    const start = async () => {
      // iOS Safari 在非安全上下文下 navigator.mediaDevices 直接是 undefined，先给出可执行的提示
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        fail('摄像头只能在 HTTPS 页面使用，当前页面不是安全上下文，请用 https 域名打开本页')
        return
      }

      try {
        // 默认分辨率常常只有 640x480，条码在画面里只剩几十像素解不出来，这里要到 1080p
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })
      } catch (err) {
        fail(describeCameraError(err))
        return
      }

      if (cancelled || !videoRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      // 连续对焦是非标准约束，支持就生效，不支持（如 iOS Safari）忽略即可，不影响后续
      try {
        await stream.getVideoTracks()[0]?.applyConstraints({
          advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
        })
      } catch {
        // 忽略：机型不支持连续对焦，靠系统自动对焦
      }

      const video = videoRef.current
      video.srcObject = stream
      try {
        await video.play()
      } catch (err) {
        fail(describeCameraError(err))
        return
      }
      if (cancelled) return

      // wasm 约 300KB，首次打开要下载并实例化；失败必须明说，否则表现成「怎么扫都不出结果」
      setStatus('正在加载识别引擎...')
      try {
        await prepareZXingModule({ overrides: WASM_OVERRIDES, fireImmediately: true })
      } catch (err) {
        fail(`条码识别引擎加载失败：${err instanceof Error ? err.message : '未知错误'}`)
        return
      }
      if (cancelled) return
      setStatus('')

      const detector = new BarcodeDetector({ formats: WANTED_FORMATS })

      const tick = async () => {
        if (cancelled) return
        try {
          const found = await detector.detect(video)
          const raw = found[0]?.rawValue?.trim() ?? ''
          if (raw) {
            const last = lastValueRef.current
            const now = Date.now()
            if (!last || last.value !== raw || now - last.at > SAME_VALUE_COOLDOWN_MS) {
              lastValueRef.current = { value: raw, at: now }
              const outcome = onDetectRef.current(raw)
              if (outcome === 'added') {
                setAddedCount((n) => n + 1)
                showFeedback(`已添加 ${raw}`, true)
              } else if (outcome === 'duplicate') {
                showFeedback(`${raw} 已在列表中`, false)
              }
            }
          }
        } catch {
          // 单帧识别失败（画面模糊、这一帧没有码等）不中断循环，下一帧继续
        }
        if (cancelled) return
        detectTimer = window.setTimeout(() => void tick(), DETECT_INTERVAL_MS)
      }
      void tick()
    }

    void start()

    return () => {
      cancelled = true
      if (detectTimer) window.clearTimeout(detectTimer)
      if (feedbackTimer) window.clearTimeout(feedbackTimer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label="摄像头扫码">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold text-white">摄像头扫码</span>
          <span className="truncate text-[11px] text-white/60">当前商家：{merchantLabel}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭摄像头"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white active:scale-[0.97] active:bg-white/15"
        >
          <X className="h-5 w-5" aria-hidden strokeWidth={2} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          autoPlay
        />

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/85 px-6">
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-500/15 px-3 py-2.5">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0 text-amber-300" aria-hidden strokeWidth={2} />
              <p className="text-xs leading-relaxed text-amber-100">{error}</p>
            </div>
          </div>
        ) : (
          <>
            {/* 取景引导框：把条码对进框内识别最快 */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-28 w-[78%] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            </div>

            {status && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                <span className="flex items-center gap-2 text-xs text-white/80">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden strokeWidth={2} />
                  {status}
                </span>
              </div>
            )}

            {feedback && (
              <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
                <span
                  className={
                    feedback.ok
                      ? 'flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white'
                      : 'flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black'
                  }
                >
                  {feedback.ok ? (
                    <CircleCheck className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
                  ) : (
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
                  )}
                  <span className="truncate">{feedback.text}</span>
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="shrink-0 space-y-2 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2.5">
        <p className="text-center text-[11px] text-white/60">
          {error ? '关闭后可继续用扫码枪或手动输入' : `把条码对进框内，识别成功会自动入列 · 本次已添加 ${addedCount} 个`}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg bg-white/15 py-2.5 text-sm font-semibold text-white active:scale-[0.99] active:bg-white/25"
        >
          完成
        </button>
      </footer>
    </div>
  )
}
