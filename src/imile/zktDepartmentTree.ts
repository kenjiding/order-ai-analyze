import type { CascaderProps } from 'antd'

export type ZktDepartmentNode = {
  id: number
  name: string
  pId: number
}

export type ZktDepartmentCascaderOption = NonNullable<CascaderProps['options']>[number]

export function parseDepartmentIds(raw: string): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function formatDepartmentIds(ids: string[]): string {
  return parseDepartmentIds(ids.join(',')).join(',')
}

export function buildDepartmentChildrenMap(nodes: ZktDepartmentNode[]): Map<number, ZktDepartmentNode[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const childrenByParent = new Map<number, ZktDepartmentNode[]>()

  for (const node of nodes) {
    const parentExists = node.pId !== 0 && byId.has(node.pId)
    const parentKey = parentExists ? node.pId : 0
    const siblings = childrenByParent.get(parentKey) ?? []
    siblings.push(node)
    childrenByParent.set(parentKey, siblings)
  }

  return childrenByParent
}

function collectLeafDepartmentIds(
  nodeId: number,
  childrenByParent: Map<number, ZktDepartmentNode[]>,
): string[] {
  const children = childrenByParent.get(nodeId) ?? []
  if (!children.length) return [String(nodeId)]
  return children.flatMap((child) => collectLeafDepartmentIds(child.id, childrenByParent))
}

/** 父节点选中时展开为所有叶子子部门 ID，供 ZKT departments 参数使用 */
export function expandDepartmentIdsToLeaves(ids: string[], nodes: ZktDepartmentNode[]): string[] {
  if (!nodes.length) return parseDepartmentIds(ids.join(','))

  const childrenByParent = buildDepartmentChildrenMap(nodes)
  const byId = new Set(nodes.map((node) => String(node.id)))
  const expanded: string[] = []

  for (const id of parseDepartmentIds(ids.join(','))) {
    const numId = Number(id)
    if (!Number.isFinite(numId) || !byId.has(id)) {
      expanded.push(id)
      continue
    }
    expanded.push(...collectLeafDepartmentIds(numId, childrenByParent))
  }

  return parseDepartmentIds(expanded.join(','))
}

export function buildDepartmentCascaderOptions(nodes: ZktDepartmentNode[]): ZktDepartmentCascaderOption[] {
  const childrenByParent = buildDepartmentChildrenMap(nodes)

  const toOptions = (parentId: number): ZktDepartmentCascaderOption[] =>
    (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      .map((node) => {
        const children = toOptions(node.id)
        return {
          value: String(node.id),
          label: node.name,
          ...(children.length ? { children } : {}),
        }
      })

  return toOptions(0)
}

export function departmentIdsToCascaderPaths(
  ids: string[],
  nodes: ZktDepartmentNode[],
): (string | number)[][] {
  const byId = new Map(nodes.map((node) => [String(node.id), node]))
  const paths: (string | number)[][] = []

  for (const id of ids) {
    const path: string[] = []
    let current = byId.get(id)
    const guard = new Set<number>()
    while (current && !guard.has(current.id)) {
      guard.add(current.id)
      path.unshift(String(current.id))
      if (current.pId === 0) break
      current = byId.get(String(current.pId))
    }
    if (path.length) paths.push(path)
  }

  return paths
}

export function cascaderPathsToDepartmentIds(
  paths: ReadonlyArray<ReadonlyArray<string | number | null>>,
): string {
  const ids = paths
    .map((path) => {
      for (let i = path.length - 1; i >= 0; i -= 1) {
        const value = path[i]
        if (value == null) continue
        const id = String(value).trim()
        if (id) return id
      }
      return ''
    })
    .filter(Boolean)
  return formatDepartmentIds(ids)
}
