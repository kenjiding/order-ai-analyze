import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { MapPinned } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const STEP_KEYS = ['fetch', 'match', 'aggregate', 'render'] as const

const COLUMNS = [
  { h: 42, delay: 0, hue: 174 },
  { h: 68, delay: 0.12, hue: 198 },
  { h: 36, delay: 0.24, hue: 152 },
  { h: 88, delay: 0.08, hue: 174 },
  { h: 54, delay: 0.32, hue: 210 },
  { h: 76, delay: 0.18, hue: 162 },
  { h: 48, delay: 0.4, hue: 186 },
  { h: 62, delay: 0.26, hue: 174 },
  { h: 34, delay: 0.36, hue: 200 },
]

const STEP_MS = 3200

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function VendorRegionMapLoading() {
  const { t } = useTranslation('vendorRegionMap')
  const steps = useMemo(
    () => STEP_KEYS.map((key) => ({ key, label: t(`loadingSteps.${key}`) })),
    [t],
  )
  const [stepIndex, setStepIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const tick = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(tick)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1))
    }, STEP_MS)
    return () => window.clearInterval(id)
  }, [steps.length])

  const active = steps[stepIndex]!
  const lingering = stepIndex === steps.length - 1 && elapsed >= Math.ceil((STEP_MS * steps.length) / 1000)

  return (
    <div className="vrm-map-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="vrm-map-loading__card vrm-glass">
        <div className="vrm-map-loading__visual" aria-hidden>
          <div className="vrm-map-loading__sky" />
          <div className="vrm-map-loading__ground" />
          <div className="vrm-map-loading__radar" />
          <div className="vrm-map-loading__city">
            {COLUMNS.map((col, index) => (
              <span
                key={index}
                className="vrm-map-loading__col"
                style={
                  {
                    '--vrm-col-h': `${col.h}%`,
                    '--vrm-col-delay': `${col.delay}s`,
                    '--vrm-col-hue': String(col.hue),
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="vrm-map-loading__pin">
            <MapPinned className="h-3.5 w-3.5" />
          </div>
        </div>

        <div className="vrm-map-loading__copy">
          <div className="vrm-map-loading__title">
            {lingering ? t('loadingLarge') : active.label}
          </div>
          <p className="vrm-map-loading__hint">
            {t('loadingWait', { seconds: formatElapsed(elapsed) })}
          </p>
        </div>

        <ol className="vrm-map-loading__steps" aria-hidden>
          {steps.map((step, index) => {
            const state =
              index < stepIndex ? 'done' : index === stepIndex ? 'active' : 'pending'
            return (
              <li key={step.key} className="vrm-map-loading__step" data-state={state}>
                <span className="vrm-map-loading__dot" />
                <span className="vrm-map-loading__step-label">{step.label}</span>
              </li>
            )
          })}
        </ol>

        <div className="vrm-map-loading__track" aria-hidden>
          <span className="vrm-map-loading__fill" />
        </div>
      </div>
    </div>
  )
}
