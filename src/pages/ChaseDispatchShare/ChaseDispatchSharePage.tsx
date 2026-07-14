import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  fetchChaseDispatchShare,
  type ChaseDispatchShareBucket,
  type ChaseDispatchShareView,
} from './chaseDispatchShareApi'
import './chaseDispatchSharePage.css'

/**
 * 催派推送外部分享页：飞书群内链接打开，无登录，仅查看/复制滞留运单号。
 * Reading: operational public share for fleet operators; cold industrial utility; Linear restraint.
 */

function collectAllWaybillNos(buckets: ChaseDispatchShareBucket[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const bucket of buckets) {
    for (const driver of bucket.drivers) {
      for (const no of driver.waybillNos) {
        const trimmed = no.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        out.push(trimmed)
      }
    }
  }
  return out
}

function useCopyToast() {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const show = (message: string) => {
    setToast(message)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), 2200)
  }

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  return { toast, show }
}

export default function ChaseDispatchSharePage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ChaseDispatchShareView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(token ? 'loading' : 'error')
  /** 展开的滞留区间；默认全部折叠 */
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(() => new Set())
  const { toast, show } = useCopyToast()

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetchChaseDispatchShare(token).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setData(result.data)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [token])

  // 外部分享页关闭全局后台网格，避免浅色纹理压在深色画布上
  useEffect(() => {
    document.documentElement.dataset.cdsShare = '1'
    return () => {
      delete document.documentElement.dataset.cdsShare
    }
  }, [])

  const allNos = useMemo(() => (data ? collectAllWaybillNos(data.buckets) : []), [data])
  const activeBuckets = useMemo(
    () => (data ? data.buckets.filter((b) => b.count > 0 && b.drivers.length > 0) : []),
    [data],
  )

  const toggleBucket = (bucketKey: string) => {
    setExpandedBuckets((prev) => {
      const next = new Set(prev)
      if (next.has(bucketKey)) next.delete(bucketKey)
      else next.add(bucketKey)
      return next
    })
  }

  const copyNos = async (nos: string[], label: string) => {
    if (nos.length === 0) {
      show('No waybills to copy')
      return
    }
    const ok = await copyTextToClipboard(nos.join('\n'))
    show(ok ? `Copied ${nos.length} · ${label}` : 'Copy failed')
  }

  if (status === 'loading') {
    return (
      <div className="cds-share">
        <div className="cds-share__state" role="status">
          <div className="cds-share__spinner" aria-hidden />
          <p className="cds-share__state-hint">Loading stagnant waybills…</p>
        </div>
      </div>
    )
  }

  if (status === 'error' || !data) {
    return (
      <div className="cds-share">
        <div className="cds-share__state">
          <p className="cds-share__brand">Chase Dispatch</p>
          <h1 className="cds-share__state-title">Link unavailable</h1>
          <p className="cds-share__state-hint">
            This share link is invalid or has expired (links stay open for 3 days). Ask the warehouse team to push again.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="cds-share">
      <div className="cds-share__frame">
        <header className="cds-share__hero">
          <p className="cds-share__brand">Chase Dispatch</p>
          <h1 className="cds-share__title">{data.vendorName}</h1>
          <p className="cds-share__meta">
            {data.baseDate} {data.pushTime} · Stagnant parcels pending delivery
          </p>
          <div className="cds-share__stats">
            <div>
              <p className="cds-share__total-label">Total stagnant</p>
              <p className="cds-share__total">{data.totalStagnant}</p>
            </div>
            <button
              type="button"
              className="cds-share__copy-all"
              disabled={allNos.length === 0}
              onClick={() => void copyNos(allNos, 'all')}
            >
              Copy all
            </button>
          </div>
        </header>

        <div className="cds-share__buckets">
          {activeBuckets.map((bucket, bucketIndex) => {
            const open = expandedBuckets.has(bucket.bucket)
            const panelId = `cds-bucket-${bucket.bucket}`
            return (
              <section
                key={bucket.bucket}
                className={`cds-share__bucket${open ? ' cds-share__bucket--open' : ''}`}
                style={{ animationDelay: `${0.06 + bucketIndex * 0.05}s` }}
              >
                <button
                  type="button"
                  className="cds-share__bucket-head"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggleBucket(bucket.bucket)}
                >
                  <span className="cds-share__bucket-chevron" aria-hidden />
                  <h2 className="cds-share__bucket-title">{bucket.bucket} days</h2>
                  <span className="cds-share__bucket-count">{bucket.count}</span>
                </button>

                {open ? (
                  <div id={panelId} className="cds-share__bucket-body">
                    {bucket.drivers.map((driver) => (
                      <div key={`${bucket.bucket}-${driver.driverCode}`} className="cds-share__driver">
                        <div className="cds-share__driver-head">
                          <div className="cds-share__driver-name">
                            {driver.driverName}
                            <span className="cds-share__driver-code">{driver.driverCode}</span>
                          </div>
                          <div className="cds-share__driver-actions">
                            <span className="cds-share__pill">{driver.count}</span>
                            <button
                              type="button"
                              className="cds-share__copy"
                              onClick={() => void copyNos(driver.waybillNos, driver.driverName)}
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                        {driver.waybillNos.length > 0 ? (
                          <ul className="cds-share__nos">
                            {driver.waybillNos.map((no) => (
                              <li key={no} className="cds-share__no">
                                {no}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="cds-share__empty-nos">No waybill numbers in this group</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>

        <p className="cds-share__foot">
          Snapshot from the chase-dispatch push. Copy waybills into your TMS or clipboard as needed. Link expires after 3
          days.
        </p>
      </div>

      <div
        className={`cds-share__toast${toast ? ' cds-share__toast--show cds-share__toast--ok' : ''}`}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
    </div>
  )
}
