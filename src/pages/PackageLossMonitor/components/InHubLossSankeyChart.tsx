import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { adminColors } from '../../../theme/adminColors'
import type { SankeyColumn, SankeyGraph } from '../inHubLossAnalytics'

type Props = {
  graph: SankeyGraph
  columns: SankeyColumn[]
}

const COLOR_RANGE = [
  adminColors.accentActive,
  adminColors.accent,
  '#5ba39c',
  adminColors.tableHeader,
  '#4a7a94',
  '#8aa4b5',
  '#c4a35a',
  '#b45309',
]

const LAYER_PREFIX: Record<SankeyColumn['key'], string> = {
  subtype: 's',
  route: 'r',
  suspect: 'd',
  vendor: 'v',
  person: 'p',
}

function nodeLabel(node: unknown): string {
  if (typeof node === 'string') return node
  if (node && typeof node === 'object' && 'key' in node) {
    const key = (node as { key?: unknown }).key
    if (typeof key === 'string') return key
  }
  return ''
}

function nodeValue(node: { value?: number }): number {
  return typeof node.value === 'number' && Number.isFinite(node.value) ? node.value : 0
}

export function InHubLossSankeyChart({ graph, columns }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { nodes, links } = graph
  const columnSize = Math.max(
    ...columns.map((column) => nodes.filter((node) => node.id.startsWith(`${LAYER_PREFIX[column.key]}:`)).length),
    1,
  )
  const height = Math.min(720, Math.max(320, 56 + columnSize * 26))
  const dataKey = useMemo(
    () =>
      `${columns.map((column) => column.key).join('-')}|${nodes
        .map((node) => `${node.id}:${node.value}:${node.detail ?? ''}`)
        .join('|')}|${links.map((link) => `${link.source}>${link.target}:${link.value}`).join('|')}`,
    [columns, links, nodes],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el || links.length === 0) return

    const detailById = new Map(nodes.flatMap((node) => (node.detail ? [[node.id, node.detail] as const] : [])))
    const nodeOrderById = new Map(nodes.map((node, index) => [node.id, index]))

    const chart = new Chart({
      container: el,
      autoFit: true,
      height,
      theme: 'light',
      paddingLeft: 8,
      paddingRight: 88,
      paddingTop: 8,
      paddingBottom: 8,
    })

    chart.options({
      type: 'sankey',
      data: { type: 'inline', value: { nodes, links } },
      layout: {
        nodeAlign: 'justify',
        nodePadding: 0.04,
        nodeWidth: 0.018,
        iterations: 0,
        nodeId: (d: { id?: string }) => d.id ?? '',
        nodeSort: (a: { id?: string; value?: number; key?: string }, b: { id?: string; value?: number; key?: string }) => {
          const orderA = typeof a.id === 'string' ? nodeOrderById.get(a.id) : undefined
          const orderB = typeof b.id === 'string' ? nodeOrderById.get(b.id) : undefined
          if (orderA != null && orderB != null && orderA !== orderB) return orderA - orderB
          return nodeValue(b) - nodeValue(a) || String(a.key ?? '').localeCompare(String(b.key ?? ''), 'zh-CN')
        },
      },
      scale: {
        color: { range: COLOR_RANGE },
      },
      style: {
        labelText: (d: { key?: string }) => d.key ?? '',
        labelSpacing: 6,
        labelFontSize: 11,
        labelFill: adminColors.text,
        labelFontWeight: 500,
        nodeStrokeWidth: 0,
        linkFillOpacity: 0.28,
      },
      tooltip: {
        nodeTitle: (d: { key?: string }) => d.key ?? '',
        nodeItems: [
          (d: { value?: number }) => ({ name: '单量', value: d.value ?? 0 }),
          (d: { id?: string; key?: string; detail?: string }) => {
            const id = typeof d.id === 'string' ? d.id : ''
            if (id.includes(':') && !id.startsWith('d:')) return undefined
            const detail =
              (typeof d.detail === 'string' && d.detail) ||
              (id ? detailById.get(id) : undefined) ||
              (typeof d.key === 'string' ? detailById.get(`d:${d.key}`) : undefined)
            if (!detail) return undefined
            return { name: '所属供应商', value: detail }
          },
        ],
        linkTitle: (d: { source?: unknown; target?: unknown }) =>
          `${nodeLabel(d.source)} → ${nodeLabel(d.target)}`,
        linkItems: [
          (d: { value?: number }) => ({
            name: '单量',
            value: d.value ?? 0,
          }),
        ],
      },
      interaction: {
        elementHighlight: true,
      },
    })

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [dataKey, height, links, nodes])

  if (links.length === 0) {
    return <p className="package-loss-viz-empty">已分析单中尚无库内丢失判定</p>
  }

  return (
    <div>
      <div
        className="package-loss-sankey-cols"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {columns.map((column) => (
          <span key={column.key}>{column.title}</span>
        ))}
      </div>
      <div
        ref={containerRef}
        className="package-loss-sankey"
        style={{ minHeight: height }}
        role="img"
        aria-label={`库内丢失${columns.map((column) => column.title).join('到')}的流向图`}
      />
    </div>
  )
}
