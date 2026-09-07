/**
 * 容器品类字典：品类从代码常量搬进 container_types 表，可新增、改名、停用。
 *
 * 为什么改动能「无缝」接进现有流转与对账：
 *   - container_type 在 DB 里是裸 varchar，没有枚举约束，加品类不需要迁移任何历史数据；
 *   - 记账、对账净额、差异结算、作废冲账全部按 containerType 分组处理，不关心值本身；
 *   - 新品类的台账行由 ensureBalanceRow 在首次记账时自动补 0，不用给每个站点预建。
 *
 * 两个不可动摇的约束：
 *   - code 建成后不可改 —— 它是历史流转、台账、审计里存的那个字符串，改了全部对不上；
 *   - 有任何引用的品类不可物理删除，只能停用。container_type 没有外键保护，
 *     删掉不会报错，但历史记录会变成没人认识的码。
 *
 * 不做缓存：品类表只有几行，查一次的开销可以忽略，这个模块也没有并发压力。
 * 之所以还留一份进程内快照，只是因为 labelOf / isActiveType 在错误消息与飞书卡片里是
 * 同步调用的，改异步会传染一大片。快照由 refreshTypes() 覆盖写，
 * 写入路径（建流转、建台账）在校验前各刷一次 —— 于是多进程之间不存在「谁的品类更旧」的问题。
 */
import { asc, eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { ContainerBusinessError } from './accountService'
import { CONTAINER_TYPES, containerTypeLabel } from './constants'

export type ContainerTypeView = {
  /** 内部标识，自动生成；界面不展示，仅排查问题时用得上 */
  code: string
  name: string
  active: boolean
  /** 已被流转或台账引用：前端据此把「删除」换成「停用」 */
  inUse: boolean
}

/** 同步快照：code → 显示名。refreshTypes 负责刷新，同步调用方直接读 */
let labelMap = new Map<string, string>()
/** 同步快照：全部已知 code（含停用），用于筛选参数与对账预置 */
let knownCodes: string[] = []
/** 同步快照：仅启用的 code，用于新建流转/台账的校验 */
let activeCodes: string[] = []

function applySnapshot(rows: schema.ContainerTypeRow[]): void {
  labelMap = new Map(rows.map((row) => [row.code, row.name]))
  knownCodes = rows.map((row) => row.code)
  activeCodes = rows.filter((row) => row.active).map((row) => row.code)
}

/** 读一次品类表并刷新同步快照 */
export async function refreshTypes(): Promise<schema.ContainerTypeRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.containerTypes)
    .orderBy(asc(schema.containerTypes.createdAt), asc(schema.containerTypes.code))
  applySnapshot(rows)
  return rows
}

/** 启动时预热一次，让同步快照在第一个请求到达前就是热的 */
export async function warmContainerTypeCache(): Promise<void> {
  try {
    await refreshTypes()
  } catch (error) {
    // 预热失败不该拖垮启动：同步读会回落到内置两种品类，业务照常
    console.warn('[containerTypes] 预热失败，暂时回落到内置品类', error)
  }
}

// ─────────────────────────────── 同步读（快照）

/**
 * 品类显示名。快照未热时回落到内置常量，再回落到 code 本身 ——
 * 和改造前 `containerTypeLabel[code] ?? code` 的行为一致，不会因为缓存冷就报错。
 */
export function labelOf(code: string): string {
  return labelMap.get(code) ?? containerTypeLabel[code as never] ?? code
}

/** 全部已知品类码（含停用）：筛选、对账预置全品类 0 用这个 */
export function knownTypeCodes(): string[] {
  return knownCodes.length > 0 ? knownCodes : [...CONTAINER_TYPES]
}

/** 仅启用的品类码：新建流转、新建台账用这个 */
export function activeTypeCodes(): string[] {
  return activeCodes.length > 0 ? activeCodes : [...CONTAINER_TYPES]
}

/** 已知品类（含停用）—— 筛选参数校验用，否则筛不出停用品类的历史数据 */
export function isKnownType(value: unknown): value is string {
  return typeof value === 'string' && knownTypeCodes().includes(value)
}

/** 启用中的品类 —— 新建流转、新建台账校验用，停用的不允许再产生新记录 */
export function isActiveType(value: unknown): value is string {
  return typeof value === 'string' && activeTypeCodes().includes(value)
}

// ─────────────────────────────── 异步读写

/** 某个品类是否已被流转明细或台账引用 —— 决定它能不能物理删 */
async function isInUse(code: string): Promise<boolean> {
  const [item] = await getDb()
    .select({ n: sql<number>`1` })
    .from(schema.containerTransferItems)
    .where(eq(schema.containerTransferItems.containerType, code))
    .limit(1)
  if (item) return true
  const [balance] = await getDb()
    .select({ n: sql<number>`1` })
    .from(schema.containerBalances)
    .where(eq(schema.containerBalances.containerType, code))
    .limit(1)
  return Boolean(balance)
}

/** 一次查出所有被引用的品类码，避免逐个品类各查两次 */
async function listUsedCodes(): Promise<Set<string>> {
  const rows = await getDb().execute<{ container_type: string }>(sql`
    select distinct container_type from container_transfer_items
    union
    select distinct container_type from container_balances
  `)
  return new Set([...rows].map((row) => row.container_type))
}

export async function listContainerTypes(includeInactive = true): Promise<ContainerTypeView[]> {
  const [rows, used] = await Promise.all([refreshTypes(), listUsedCodes()])
  return rows
    .filter((row) => includeInactive || row.active)
    .map((row) => ({
      code: row.code,
      name: row.name,
      active: row.active,
      inUse: used.has(row.code),
    }))
}

/**
 * 自动生成品类编码。
 *
 * code 只是历史数据里的内部标识，用户心里想的是「托盘」而不是 PALLET，
 * 让人手填等于把实现细节摊给业务方，还会填出空格、大小写混写这类没法回收的脏值。
 * 用时间戳的 base36 保证唯一，不必查表也不怕并发。
 */
function generateCode(): string {
  return `CT_${Date.now().toString(36).toUpperCase()}`
}

function normalizeName(raw: unknown, field: string, max: number): string {
  const text = String(raw ?? '').trim()
  if (!text) throw new ContainerBusinessError(`请填写${field}`)
  if (text.length > max) throw new ContainerBusinessError(`${field}过长`)
  return text
}

export async function createContainerType(input: { name?: unknown }): Promise<ContainerTypeView> {
  const name = normalizeName(input.name, '品类名称', 64)

  const existing = await getDb()
    .select({ code: schema.containerTypes.code })
    .from(schema.containerTypes)
    .where(sql`lower(${schema.containerTypes.name}) = lower(${name})`)
    .limit(1)
  if (existing.length > 0) throw new ContainerBusinessError('品类名称已存在', 409)

  const code = generateCode()
  await getDb().insert(schema.containerTypes).values({ code, name })
  const list = await listContainerTypes()
  return list.find((row) => row.code === code)!
}

export async function updateContainerType(
  code: string,
  input: { name?: unknown; active?: unknown },
): Promise<ContainerTypeView> {
  const [existing] = await getDb()
    .select()
    .from(schema.containerTypes)
    .where(eq(schema.containerTypes.code, code))
    .limit(1)
  if (!existing) throw new ContainerBusinessError('品类不存在', 404)

  const patch: Partial<schema.NewContainerTypeRow> = { updatedAt: new Date() }
  if (input.name !== undefined) {
    const name = normalizeName(input.name, '品类名称', 64)
    const dup = await getDb()
      .select({ code: schema.containerTypes.code })
      .from(schema.containerTypes)
      .where(sql`lower(${schema.containerTypes.name}) = lower(${name}) and ${schema.containerTypes.code} <> ${code}`)
      .limit(1)
    if (dup.length > 0) throw new ContainerBusinessError('品类名称已存在', 409)
    patch.name = name
  }
  if (input.active !== undefined) {
    const active = input.active === true
    // 停用最后一个启用品类会让所有新建流转/台账无品类可选，直接把系统卡死
    if (!active && existing.active) {
      const remaining = (await refreshTypes()).filter((row) => row.active && row.code !== code)
      if (remaining.length === 0) throw new ContainerBusinessError('至少要保留一个启用的品类')
    }
    patch.active = active
  }

  await getDb().update(schema.containerTypes).set(patch).where(eq(schema.containerTypes.code, code))
  const list = await listContainerTypes()
  return list.find((row) => row.code === code)!
}

/** 物理删除：仅限从未被引用的品类。有历史记录的必须走停用，否则历史数据变孤儿 */
export async function deleteContainerType(code: string): Promise<void> {
  const [existing] = await getDb()
    .select({ code: schema.containerTypes.code })
    .from(schema.containerTypes)
    .where(eq(schema.containerTypes.code, code))
    .limit(1)
  if (!existing) throw new ContainerBusinessError('品类不存在', 404)
  if (await isInUse(code)) {
    throw new ContainerBusinessError('该品类已有流转或台账记录，不能删除，请改为停用')
  }
  const remaining = (await refreshTypes()).filter((row) => row.active && row.code !== code)
  if (remaining.length === 0) throw new ContainerBusinessError('至少要保留一个启用的品类')

  await getDb().delete(schema.containerTypes).where(eq(schema.containerTypes.code, code))
  await refreshTypes()
}
