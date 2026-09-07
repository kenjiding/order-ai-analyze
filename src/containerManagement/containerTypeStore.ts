/**
 * 容器品类字典的前端缓存。
 *
 * 最要紧的一件事是 injectLabels：把表里的品类名注入 i18next 的 container 命名空间，
 * 于是全站 20 处 `t(`containerType.${code}`)` 一行都不用改就能显示动态品类的名字。
 * 内置的两个品类在 json 里已有同名 key，注入的值与之一致，不会互相打架。
 *
 * 走 module 级缓存而不是 context：品类是全站基础数据，三个容器页面都要用，
 * 套一层 Provider 只是把同一份数据多包一层。
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { i18n } from '../i18n'
import { fetchContainerTypes } from './api'
import type { ContainerTypeItem } from './types'

/** 这两个在 i18n json 里有正式的中英文案，注入时英文侧要跳过，否则会被覆盖成中文名 */
const BUILTIN_CODES = ['BIG_BASKET', 'SILVER_BOX']

let rows: ContainerTypeItem[] = []
let loaded = false
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function injectLabels(list: ContainerTypeItem[]): void {
  if (list.length === 0) return
  i18n.addResources(
    'zh-CN',
    'container',
    Object.fromEntries(list.map((row) => [`containerType.${row.code}`, row.name])),
  )
  // 品类只维护一个名称，英文界面沿用同一个名字；内置两种在 json 里已有英文文案，不会被覆盖成中文
  i18n.addResources(
    'en',
    'container',
    Object.fromEntries(
      list.filter((row) => !BUILTIN_CODES.includes(row.code)).map((row) => [`containerType.${row.code}`, row.name]),
    ),
  )
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ContainerTypeItem[] {
  return rows
}

/** 拉取品类并注入显示名；force=true 用于品类管理页改完之后刷新全站 */
export async function loadContainerTypes(force = false): Promise<void> {
  if (loaded && !force) return
  if (inflight && !force) return inflight
  inflight = (async () => {
    const res = await fetchContainerTypes()
    if (res.ok) {
      rows = res.data
      loaded = true
      injectLabels(rows)
      emit()
    }
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** 全部品类（含停用）：品类管理页与筛选下拉用 —— 停用品类的历史数据要筛得出来 */
export function useContainerTypes(): ContainerTypeItem[] {
  const list = useSyncExternalStore(subscribe, getSnapshot)
  useEffect(() => {
    void loadContainerTypes()
  }, [])
  return list
}

/** 仅启用的品类，按 sortOrder 排好：新建流转、新建台账的下拉用 */
export function useActiveContainerTypes(): ContainerTypeItem[] {
  // 必须 memo：filter 每次渲染都产生新数组，调用方拿它当 useEffect/useMemo 依赖会无限重渲染
  const list = useContainerTypes()
  return useMemo(() => list.filter((row) => row.active), [list])
}

/**
 * 同步读启用品类码。给 useState 初始值这类拿不到 hook 的地方用，
 * 缓存未加载时返回空数组，调用方需要能接受「先空后有」。
 */
export function activeContainerTypeCodes(): string[] {
  return rows.filter((row) => row.active).map((row) => row.code)
}
