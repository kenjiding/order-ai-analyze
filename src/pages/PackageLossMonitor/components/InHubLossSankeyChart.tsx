import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { adminColors } from '../../../theme/adminColors'
import {
  UNLABELED_VENDOR,
  type SankeyColumn,
  type SankeyGraph,
  type SankeyLink,
} from '../inHubLossAnalytics'

type Props = {
  graph: SankeyGraph
  columns: SankeyColumn[]
}

const VENDOR_COLORS = [
  '#1f6f68',
  '#d97706',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#0f766e',
  '#ea580c',
  '#0284c7',
  '#4d7c0f',
  '#9333ea',
  '#b45309',
  '#0e7490',
]

const UNLABELED_VENDOR_COLOR = '#94a3b8'
const NODE_FILL = adminColors.tableHeader

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

function nodeIdOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (node && typeof node === 'object' && 'id' in node) {
    const id = (node as { id?: unknown }).id
    if (typeof id === 'string') return id
  }
  return ''
}

function nodeValue(node: { value?: number }): number {
  return typeof node.value === 'number' && Number.isFinite(node.value) ? node.value : 0
}

function uniqueVendors(links: SankeyLink[]): string[] {
  const vendors: string[] = []
  const seen = new Set<string>()
  for (const link of links) {
    if (seen.has(link.vendor)) continue
    seen.add(link.vendor)
    vendors.push(link.vendor)
  }
  return vendors
}

function vendorColorMap(vendors: readonly string[]): Map<string, string> {
  const labeled = vendors.filter((vendor) => vendor !== UNLABELED_VENDOR)
  const colors = new Map<string, string>()
  labeled.forEach((vendor, index) => {
    colors.set(vendor, VENDOR_COLORS[index % VENDOR_COLORS.length])
  })
  if (vendors.includes(UNLABELED_VENDOR)) colors.set(UNLABELED_VENDOR, UNLABELED_VENDOR_COLOR)
  return colors
}

function linkVendor(d: unknown, links: SankeyLink[]): string {
  if (d && typeof d === 'object') {
    const rec = d as { vendor?: unknown; index?: unknown; source?: unknown; target?: unknown; value?: unknown }
    if (typeof rec.vendor === 'string' && rec.vendor) return rec.vendor
    if (typeof rec.index === 'number' && links[rec.index]) return links[rec.index].vendor
    const source = nodeIdOf(rec.source)
    const target = nodeIdOf(rec.target)
    const matches = links.filter((link) => link.source === source && link.target === target)
    if (matches.length === 1) return matches[0].vendor
    const value = Number(rec.value)
    const byValue = matches.filter((link) => link.value === value)
    if (byValue.length === 1) return byValue[0].vendor
  }
  return UNLABELED_VENDOR
}

export function InHubLossSankeyChart({ graph, columns }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { nodes, links } = graph
  const vendors = useMemo(() => uniqueVendors(links), [links])
  const colors = useMemo(() => vendorColorMap(vendors), [vendors])
  const columnSize = Math.max(
    ...columns.map((column) => nodes.filter((node) => node.id.startsWith(`${LAYER_PREFIX[column.key]}:`)).length),
    1,
  )
  const height = Math.min(720, Math.max(320, 56 + columnSize * 26))
  const dataKey = useMemo(
    () =>
      `${columns.map((column) => column.key).join('-')}|${nodes
        .map((node) => `${node.id}:${node.value}:${node.detail ?? ''}`)
        .join('|')}|${links.map((link) => `${link.source}>${link.target}:${link.value}:${link.vendor}`).join('|')}`,
    [columns, links, nodes],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el || links.length === 0) return

    const detailById = new Map(nodes.flatMap((node) => (node.detail ? [[node.id, node.detail] as const] : [])))
    const nodeOrderById = new Map(nodes.map((node, index) => [node.id, index]))
    const vendorOrder = new Map(vendors.map((vendor, index) => [vendor, index]))

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
      encode: {
        nodeKey: (d: { id?: string; key?: string }) => d.id ?? d.key ?? '',
        nodeColor: () => 'sankey-node',
      },
      layout: {
        nodeAlign: 'justify',
        nodePadding: 0.04,
        nodeWidth: 0.018,
        iterations: 0,
        nodeId: (d: { id?: string; key?: string }) => d.id ?? d.key ?? '',
        nodeSort: (a: { id?: string; value?: number; key?: string }, b: { id?: string; value?: number; key?: string }) => {
          const orderA = typeof a.id === 'string' ? nodeOrderById.get(a.id) : undefined
          const orderB = typeof b.id === 'string' ? nodeOrderById.get(b.id) : undefined
          if (orderA != null && orderB != null && orderA !== orderB) return orderA - orderB
          return nodeValue(b) - nodeValue(a) || String(a.key ?? '').localeCompare(String(b.key ?? ''), 'zh-CN')
        },
        linkSort: (a: { index?: number; value?: number }, b: { index?: number; value?: number }) => {
          const vendorA = typeof a.index === 'number' ? links[a.index]?.vendor : undefined
          const vendorB = typeof b.index === 'number' ? links[b.index]?.vendor : undefined
          const orderA = vendorOrder.get(vendorA ?? '') ?? Number.MAX_SAFE_INTEGER
          const orderB = vendorOrder.get(vendorB ?? '') ?? Number.MAX_SAFE_INTEGER
          if (orderA !== orderB) return orderA - orderB
          return nodeValue(b) - nodeValue(a)
        },
      },
      scale: {
        color: { range: [NODE_FILL] },
      },
      style: {
        labelText: (d: { key?: string }) => d.key ?? '',
        labelSpacing: 6,
        labelFontSize: 11,
        labelFill: adminColors.text,
        labelFontWeight: 500,
        nodeFill: NODE_FILL,
        nodeStrokeWidth: 0,
        linkFill: (d: unknown) => colors.get(linkVendor(d, links)) ?? UNLABELED_VENDOR_COLOR,
        linkFillOpacity: 0.45,
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
            value: Number(d.value) || 0,
          }),
          (d: unknown) => ({
            name: '所属供应商',
            value: linkVendor(d, links),
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
  }, [colors, dataKey, height, links, nodes, vendors])

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
        aria-label={`库内丢失${columns.map((column) => column.title).join('到')}的流向图，连线按所属供应商着色`}
      />
    </div>
  )
}
