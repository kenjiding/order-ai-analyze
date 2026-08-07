import { STATUS_COLORS, STATUS_LABELS } from './driverMapConstants'
import type { DriverMapPointStatus } from './driverMapTypes'

const STYLE_ID = 'driver-map-infowindow-skin'

/** 覆盖 MapLibre Popup 默认白框，做成干净的运营卡片 */
export function ensureDriverMapInfoWindowStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .maplibregl-popup-content {
      padding: 0 !important;
      border-radius: 14px !important;
      box-shadow:
        0 0 0 1px rgba(15, 23, 42, 0.06),
        0 18px 40px -18px rgba(15, 23, 42, 0.45) !important;
      overflow: hidden !important;
      background: transparent !important;
    }
    .dm-iw {
      width: 292px;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #0f172a;
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    }
    .dm-iw__rail {
      display: grid;
      grid-template-columns: 4px 1fr;
      min-height: 100%;
    }
    .dm-iw__accent {
      background: var(--dm-accent);
    }
    .dm-iw__body {
      padding: 14px 14px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
    }
    .dm-iw__close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.06);
      color: #475569;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      line-height: 1;
      padding: 0;
    }
    .dm-iw__close:hover {
      background: rgba(15, 23, 42, 0.12);
      color: #0f172a;
    }
    .dm-iw__top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .dm-iw__title {
      margin: 0;
      font-size: 15px;
      line-height: 1.25;
      font-weight: 650;
      letter-spacing: -0.02em;
      color: #0f172a;
    }
    .dm-iw__seq {
      flex: none;
      min-width: 28px;
      height: 28px;
      padding: 0 7px;
      border-radius: 999px;
      background: var(--dm-accent);
      color: #fff;
      font-size: 13px;
      font-weight: 800;
      line-height: 28px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      box-shadow: 0 6px 14px -8px var(--dm-accent);
    }
    .dm-iw__pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      padding: 3px 9px 3px 7px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--dm-accent) 12%, white);
      color: var(--dm-accent);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .dm-iw__pill-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--dm-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--dm-accent) 18%, transparent);
    }
    .dm-iw__grid {
      display: grid;
      gap: 8px;
      margin: 0;
    }
    .dm-iw__row {
      display: grid;
      grid-template-columns: 52px 1fr;
      gap: 8px;
      align-items: start;
    }
    .dm-iw__k {
      margin: 0;
      font-size: 11px;
      line-height: 1.45;
      color: #64748b;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .dm-iw__v {
      margin: 0;
      font-size: 12.5px;
      line-height: 1.45;
      color: #1e293b;
      word-break: break-word;
    }
    .dm-iw__v--mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      letter-spacing: -0.01em;
    }
    .dm-iw__addr {
      margin: 0;
      padding: 10px 11px;
      border-radius: 10px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      font-size: 12px;
      line-height: 1.5;
      color: #334155;
    }
    .dm-iw__addr-label {
      display: block;
      margin-bottom: 2px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #94a3b8;
    }
  `
  document.head.appendChild(style)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function buildPointInfoWindowHtml(input: {
  courierName: string
  waybillNo: string
  status: DriverMapPointStatus
  time: string
  address: string
  sequence?: number
  problemReason?: string
}): string {
  const accent = STATUS_COLORS[input.status]
  const statusLabel = STATUS_LABELS[input.status]
  const seq =
    typeof input.sequence === 'number'
      ? `<span class="dm-iw__seq">${input.sequence > 999 ? '999+' : input.sequence}</span>`
      : ''
  const reasonRow =
    input.status === 'problem'
      ? `<div class="dm-iw__row">
              <dt class="dm-iw__k">原因</dt>
              <dd class="dm-iw__v">${escapeHtml(input.problemReason?.trim() || '—')}</dd>
            </div>`
      : ''

  return `
    <div class="dm-iw" style="--dm-accent:${accent}">
      <div class="dm-iw__rail">
        <div class="dm-iw__accent" aria-hidden="true"></div>
        <div class="dm-iw__body">
          <button type="button" class="dm-iw__close" aria-label="关闭" title="关闭">&times;</button>
          <div class="dm-iw__top" style="padding-right:28px">
            <div>
              <p class="dm-iw__title">${escapeHtml(input.courierName)}</p>
              <div class="dm-iw__pill" style="margin-top:8px">
                <span class="dm-iw__pill-dot" aria-hidden="true"></span>
                ${escapeHtml(statusLabel)}
              </div>
            </div>
            ${seq}
          </div>
          <dl class="dm-iw__grid">
            <div class="dm-iw__row">
              <dt class="dm-iw__k">运单</dt>
              <dd class="dm-iw__v dm-iw__v--mono">${escapeHtml(input.waybillNo)}</dd>
            </div>
            <div class="dm-iw__row">
              <dt class="dm-iw__k">时间</dt>
              <dd class="dm-iw__v">${escapeHtml(input.time || '—')}</dd>
            </div>
            ${reasonRow}
          </dl>
          <p class="dm-iw__addr">
            <span class="dm-iw__addr-label">收件地址</span>
            ${escapeHtml(input.address || '—')}
          </p>
        </div>
      </div>
    </div>
  `
}
