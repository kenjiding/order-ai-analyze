import { useState, type ReactNode } from 'react'
import { Image, Modal, Spin, Tag, Timeline } from 'antd'

export type OrderTrackEvent = {
  content: string
  time: string
  trackStageTx?: string
  trackType?: string
  proofFileKeys?: string[]
}

const STAGE_DOT_COLOR: Record<string, string> = {
  订单提交: 'blue',
  已揽件: 'cyan',
  转运: 'purple',
  派送: 'green',
}

const TRACK_TYPE_COLORS: Record<string, string> = {
  Schedule: 'processing',
  Problem: 'error',
  Delivery: 'success',
}

const TRACK_TYPE_LABELS: Record<string, string> = {
  Schedule: '计划',
  Problem: '问题件',
  Delivery: '派送',
}

const VIEW_PROOF_RE = /【View Proof】/g

function sortDesc(events: OrderTrackEvent[]): OrderTrackEvent[] {
  return [...events].sort((a, b) => b.time.localeCompare(a.time))
}

function renderContent(content: string, hasProof: boolean, onViewProof: () => void): ReactNode {
  if (!hasProof) return content
  const parts = content.split(VIEW_PROOF_RE)
  if (parts.length === 1) return content
  const nodes: ReactNode[] = []
  parts.forEach((part, i) => {
    if (part) nodes.push(part)
    if (i < parts.length - 1) {
      nodes.push(
        <button
          key={`proof-${i}`}
          type="button"
          onClick={onViewProof}
          className="mx-0.5 inline-flex items-center rounded px-1 py-0.5 text-[13px] font-semibold text-blue-600 underline decoration-dotted underline-offset-2 hover:bg-blue-50"
        >
          查看凭证
        </button>,
      )
    }
  })
  return nodes
}

type Props = {
  events: OrderTrackEvent[]
  /** 问题件轨迹里「View Proof」的 fileKey → 真实图片地址；未传则不渲染"查看凭证"按钮 */
  getProofImageUrl?: (fileKey: string) => Promise<string>
  emptyText?: string
}

/** 订单轨迹时间线展示：按时间倒序渲染，支持问题件凭证图片预览。 */
export function OrderTrackTimeline({ events, getProofImageUrl, emptyText = '暂无轨迹数据' }: Props) {
  const [preview, setPreview] = useState<{ open: boolean; loading: boolean; urls: string[]; error: string }>({
    open: false,
    loading: false,
    urls: [],
    error: '',
  })

  const handleViewProof = async (fileKeys: string[]) => {
    if (!getProofImageUrl || !fileKeys.length) return
    setPreview({ open: true, loading: true, urls: [], error: '' })
    const results = await Promise.allSettled(fileKeys.map((k) => getProofImageUrl(k)))
    const urls = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map((r) => r.value)
    setPreview({ open: true, loading: false, urls, error: urls.length ? '' : '凭证图片获取失败' })
  }

  const sorted = sortDesc(events)
  if (!sorted.length) {
    return <div className="flex items-center justify-center py-10 text-sm text-slate-400">{emptyText}</div>
  }

  return (
    <>
      <Timeline
        items={sorted.map((evt) => {
          const stageColor = STAGE_DOT_COLOR[evt.trackStageTx ?? ''] ?? 'gray'
          const typeTagColor = evt.trackType ? TRACK_TYPE_COLORS[evt.trackType] : null
          const typeTagLabel = evt.trackType ? TRACK_TYPE_LABELS[evt.trackType] : null
          const hasProof = Boolean(getProofImageUrl && evt.proofFileKeys?.length)
          return {
            color: stageColor,
            children: (
              <div className="rounded-md px-2 py-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs tabular-nums text-slate-500">{evt.time}</span>
                  {evt.trackStageTx ? (
                    <Tag color={stageColor} className="m-0 border-0 text-[11px] leading-tight">
                      {evt.trackStageTx}
                    </Tag>
                  ) : null}
                  {typeTagLabel ? (
                    <Tag color={typeTagColor ?? 'default'} className="m-0 border-0 text-[11px] leading-tight">
                      {typeTagLabel}
                    </Tag>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[13px] leading-snug text-slate-800">
                  {renderContent(evt.content, hasProof, () => void handleViewProof(evt.proofFileKeys ?? []))}
                </p>
              </div>
            ),
          }
        })}
      />
      <Modal
        open={preview.open}
        onCancel={() => setPreview((p) => ({ ...p, open: false }))}
        footer={null}
        title="问题件凭证"
      >
        {preview.loading ? (
          <div className="flex items-center justify-center py-10">
            <Spin />
          </div>
        ) : preview.error ? (
          <div className="py-6 text-center text-sm text-red-500">{preview.error}</div>
        ) : (
          <Image.PreviewGroup>
            <div className="grid grid-cols-3 gap-2">
              {preview.urls.map((url) => (
                <Image key={url} src={url} alt="" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
              ))}
            </div>
          </Image.PreviewGroup>
        )}
      </Modal>
    </>
  )
}
