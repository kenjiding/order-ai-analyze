/**
 * 供应商范围归属 —— 「这单属于哪个供应商的统计范围」的唯一权威。
 *
 * 判定链：courierVendorCode 归属 → routeCode 纳入名单收窄 → 路由码白名单剔除。
 * 「出仓派签达成分析」「滞留数据告警」「24小时派签告警」「司机地图」「区域地图」「催派推送」
 * 共用同一份供应商配置（fleet_supplier_push_configs），也必须共用这里的同一套判定；业务侧
 * 不允许重抄过滤条件，改口径只改这个文件。
 *
 * 「遍历 scopes、挑出这一行属于哪个/哪几个」这件事唯一走 resolveConfigScopesForRow——它在
 * isRowInConfigScope(IgnoringWhitelist) 之上额外处理了「vendorCode 精确匹配但路由被收窄」
 * 的兜底归属（典型场景：临时借调别家供应商的司机跑了这条路由），不建 scopes 循环的业务不需要
 * 关心这个兜底，但只要是「for scope of scopes 判定归属」的写法，一律用它，不要手写循环。
 */
import type { FleetSupplierPushConfig } from '../db/schema'
import { parseRouteCodes, supplierDisplayName } from '../supplierPushConfigs'

/** 纳入名单 / 白名单，均按 vendorCode 索引；map 无该供应商 = 不收窄 / 无白名单 */
export type VendorScopeMaps = {
  routeCodesByVendor: Map<string, Set<string>>
  routeCodeWhitelistByVendor: Map<string, Set<string>>
}

export function normCode(code: unknown): string {
  return typeof code === 'string' ? code.trim() : ''
}

/**
 * 路由码纳入名单：供应商配置了 routeCode 时，只保留命中的运单。
 * - map 无该供应商 → 不按路由码收窄（未配置供应商 / 老任务）
 * - map 有该供应商但集合为空 → 无匹配
 */
export function isRouteCodeAllowed(
  vendorCode: string,
  routeCode: string,
  routeCodesByVendor: Map<string, Set<string>>,
): boolean {
  const allowed = routeCodesByVendor.get(vendorCode)
  if (!allowed) return true
  return allowed.has(routeCode.trim())
}

/** 路由码白名单命中：该供应商这条数据要剔除，不参与任何统计 */
export function isWhitelisted(
  vendorCode: string,
  routeCode: string,
  routeCodeWhitelistByVendor: Map<string, Set<string>>,
): boolean {
  return routeCodeWhitelistByVendor.get(vendorCode)?.has(routeCode.trim()) ?? false
}

/** 归属判定唯一入口：routeCode 纳入收窄 + 白名单剔除（vendorCode 归属由调用方按行匹配后传入） */
export function isRowInVendorScope(
  vendorCode: string,
  rowRouteCode: unknown,
  scope: VendorScopeMaps,
): boolean {
  const routeCode = normCode(rowRouteCode)
  return (
    isRouteCodeAllowed(vendorCode, routeCode, scope.routeCodesByVendor) &&
    !isWhitelisted(vendorCode, routeCode, scope.routeCodeWhitelistByVendor)
  )
}

/**
 * 单条推送配置的独立范围：同一 vendorCode 可有多条配置（ADL-City / ADL-Lu 共用编码、
 * 各管一批路由码），key 用配置自己的 id，使它们各自独立统计、互不混算。
 */
export type ConfigScope = {
  key: string
  vendorCode: string
  /** 路由码纳入名单；undefined/空集 = 不按路由码收窄 */
  routeCodes?: Set<string>
  routeCodeWhitelist?: Set<string>
}

/**
 * 「这一行属不属于这条配置」的唯一判定：逐配置统计 / 逐配置取数都走这里，业务侧不许重抄。
 * 归属：courierVendorCode 有值 → 必须精确等于该 scope 的 vendorCode；为空（尚未派件，
 * iMile 还没回填承运商）→ 按 routeCode 兜底，且必须配了 routeCodes 才能兜底。
 * 归属之后统一过：纳入名单收窄 → 白名单剔除。
 */
export function isRowInConfigScope(
  scope: Pick<ConfigScope, 'vendorCode' | 'routeCodes' | 'routeCodeWhitelist'>,
  rowVendorCode: unknown,
  rowRouteCode: unknown,
): boolean {
  if (!isRowInConfigScopeIgnoringWhitelist(scope, rowVendorCode, rowRouteCode)) return false
  return !scope.routeCodeWhitelist?.has(normCode(rowRouteCode))
}

/**
 * 归属 + 纳入名单收窄，但不做白名单剔除。
 * 「11点前出仓告警」要把白名单命中的行单独统计成 whitelistStat（而不是丢弃），用这个入口；
 * 其余业务一律用 isRowInConfigScope。
 */
export function isRowInConfigScopeIgnoringWhitelist(
  scope: Pick<ConfigScope, 'vendorCode' | 'routeCodes'>,
  rowVendorCode: unknown,
  rowRouteCode: unknown,
): boolean {
  const vendorCode = normCode(rowVendorCode)
  const routeCode = normCode(rowRouteCode)
  // 配置未选供应商（纯路由码口径）：完全不看行上的承运商，只认路由码命中；
  // 没配路由码就谁都不匹配——否则一条空配置会吃下整个站点的运单。
  if (!scope.vendorCode) {
    return scope.routeCodes ? scope.routeCodes.has(routeCode) : false
  }
  if (vendorCode) {
    if (vendorCode !== scope.vendorCode) return false
  } else if (!scope.routeCodes?.has(routeCode)) {
    return false
  }
  // 纳入名单收窄（兜底分支上面已确认命中，这里恒真，保留是为了单一实现来源）
  if (scope.routeCodes && !scope.routeCodes.has(routeCode)) return false
  return true
}

export type ScopeMatch<S> = {
  scope: S
  /** true = 正常判定零命中，是凭 vendorCode 精确匹配兜底落下来的（见下方函数注释） */
  isForeignRoute: boolean
}

/**
 * 「这一行落在 scopes 里的哪一个/哪几个」的唯一入口：逐 scope 遍历判定都走这里，不许各业务自己写循环。
 *
 * 正常情况下返回所有命中的 scope（可能 0 个、1 个，或多个——两家供应商共担同一路由码时业务上允许
 * 同时命中多个，各自独立统计，见 isRowInConfigScopeIgnoringWhitelist 的归属语义）。
 *
 * **兜底**：如果一个都没命中、但这一行的 courierVendorCode 精确等于某个 scope 的 vendorCode——
 * 说明承运商确实是这家供应商，只是这条路由没配进它任何一条子配置的 routeCodes 名单里（典型场景：
 * 临时借调别家供应商的司机跑了这条路由）。原逻辑会把这一整行丢弃、两头供应商都统计不到；这里改成
 * 落到该 vendorCode 下**第一条**匹配的 scope（scopes 顺序来自配置创建时间，同一批次内稳定，不会
 * 在不同供应商子配置间抖动），并用 isForeignRoute=true 告诉调用方「这是兜底命中，不是这行本来该在
 * 的位置」，由调用方决定要不要打日志、要不要在前端标注。
 *
 * 兜底与「未派件按路由码兜底归属」（isRowInConfigScopeIgnoringWhitelist 内部 !scope.vendorCode 分支）
 * 是两回事：这里只在 vendorCode 非空时触发，不会与未派件场景混淆。
 *
 * ignoreWhitelist=false（对应 isRowInConfigScope）时，兜底落到的 scope 如果把这条路由配进了自己的
 * routeCodeWhitelist，兜底结果也要被白名单剔除——不能因为走了兜底分支就绕开白名单规则。
 * ignoreWhitelist=true 时原样返回 scope，调用方自己按 scope.routeCodeWhitelist 分桶（如滞留数据告警）。
 */
export function resolveConfigScopesForRow<
  S extends Pick<ConfigScope, 'vendorCode' | 'routeCodes' | 'routeCodeWhitelist'>,
>(
  scopes: S[],
  rowVendorCode: unknown,
  rowRouteCode: unknown,
  opts: { ignoreWhitelist: boolean },
): ScopeMatch<S>[] {
  const matchFn = opts.ignoreWhitelist ? isRowInConfigScopeIgnoringWhitelist : isRowInConfigScope
  const hits = scopes.filter((scope) => matchFn(scope, rowVendorCode, rowRouteCode))
  if (hits.length > 0) return hits.map((scope) => ({ scope, isForeignRoute: false }))

  const vendorCode = normCode(rowVendorCode)
  if (!vendorCode) return []
  const fallback = scopes.find((scope) => scope.vendorCode === vendorCode)
  if (!fallback) return []
  const routeCode = normCode(rowRouteCode)
  if (!opts.ignoreWhitelist && fallback.routeCodeWhitelist?.has(routeCode)) return []
  return [{ scope: fallback, isForeignRoute: true }]
}

/**
 * 路由归属优先的判定：仅供「滞留数据告警」使用，不要在其它业务里复用。
 *
 * 背景：正常判定（isRowInConfigScope 系列）是 courierVendorCode 精确匹配优先——如果这一单已经被
 * 别家供应商的司机扫出仓（典型场景：代清货/借调），即使路由码配在本供应商名下，也会被挡在外面。
 * 滞留数据告警统计的是"这条路由底下还有多少件没处理完"，路由本身的归属不该因为谁家司机帮忙跑了
 * 一趟就变了，所以这里反过来：**路由码命中哪些供应商的纳入名单，就算给那些供应商，不看
 * courierVendorCode**；一个都没命中（没人把这条路由配进名单）时，才退回"courierVendorCode 精确
 * 匹配"的老规则，兜底"本供应商司机跑了路由名单外的路由"的场景。
 *
 * 必须整批 scopes 一起判断、不能逐个 scope 单独调用：如果路由已经命中了 A 供应商的名单，就不能再
 * 因为"这一单的承运商恰好是 B 供应商自己"而让 B 也兜底命中一遍——否则一单会被两家供应商重复计数
 * （B 的兜底规则本意是"B 自己的司机跑了 B 名单外的路由"，不该在路由已经有名义归属时触发）。
 *
 * 不要用在「出仓派签达成分析」「24H派签告警」「司机地图」「区域地图」「催派推送」：那几个关心的是
 * "这一单实际是谁在送/该催谁"，必须按实际承运商算，按路由码优先反而会把别家司机的派签成绩/轨迹
 * 记到路由配置的供应商头上。
 */
export function resolveConfigScopesForRowByRoutePriority<
  S extends Pick<ConfigScope, 'vendorCode' | 'routeCodes' | 'routeCodeWhitelist'>,
>(scopes: S[], rowVendorCode: unknown, rowRouteCode: unknown, opts: { ignoreWhitelist: boolean }): S[] {
  const routeCode = normCode(rowRouteCode)
  const routeHits = scopes.filter((scope) => scope.routeCodes?.has(routeCode))
  const vendorCode = normCode(rowVendorCode)
  const candidates =
    routeHits.length > 0
      ? routeHits
      : scopes.filter((scope) => Boolean(vendorCode) && Boolean(scope.vendorCode) && vendorCode === scope.vendorCode)
  if (opts.ignoreWhitelist) return candidates
  return candidates.filter((scope) => !scope.routeCodeWhitelist?.has(routeCode))
}

/**
 * routeCode → 配置了该路由码的供应商列表：从 routeCodesByVendor 反转而来，
 * 供 courierVendorCode 为空时（尚未派件，iMile 还没回填承运商）按路由码兜底归属使用。
 * 一个路由码可能同时配置在多个供应商名下（两家供应商共担同一路由，业务上正常）——
 * 每个供应商各自独立按自己配置的路由码匹配、各自统计，不存在"归属唯一"的排他性判断。
 */
export function buildRouteCodeVendorsMap(routeCodesByVendor: Map<string, Set<string>>): Map<string, string[]> {
  const routeToVendors = new Map<string, string[]>()
  for (const [vendorCode, routeCodes] of routeCodesByVendor) {
    for (const routeCode of routeCodes) {
      const list = routeToVendors.get(routeCode)
      if (list) list.push(vendorCode)
      else routeToVendors.set(routeCode, [vendorCode])
    }
  }
  return routeToVendors
}

/** 按 routeCode 查出所有配置了该路由码的供应商（可能为空、一个或多个） */
export function resolveVendorCodesByRouteCode(
  routeCode: unknown,
  routeCodeVendorsMap: Map<string, string[]>,
): string[] {
  const code = normCode(routeCode)
  if (!code) return []
  return routeCodeVendorsMap.get(code) ?? []
}

type SupplierUnitConfigRow = Pick<
  FleetSupplierPushConfig,
  'vendorCode' | 'vendorName' | 'supplierNickname' | 'routeCode' | 'routeCodeWhitelist'
>

/**
 * 一个「供应商单位」= 同 vendorCode 下同一个展示名的若干条配置，是所有按供应商出数的业务的统计主键。
 *
 * 为什么不能拿 vendorCode 当主键：ADL-City 和 ADL-Lu 共用 vendorCode SRM2401068，业务上是两家，
 * 靠各自负责的路由码分开。按 vendorCode 合并会让两家的数据混算成一份。
 *
 * 为什么也不拿配置行 id 当主键：同一家会在多个 region 各建一条配置（ADL-Lu 在 SA 和 system 各一条），
 * 按 id 分会让同一家裂成多行。按展示名归并、路由码取并集，才对应业务上真实的"一家供应商"。
 */
export type SupplierUnit = {
  supplierKey: string
  supplierName: string
  vendorCode: string
  routeCodes: Set<string>
  routeCodeWhitelist: Set<string>
}

/** 单位键：前后端必须用同一套算法算出同一个 key，前端才能把配置 join 上后端汇总 */
export function buildSupplierUnitKey(vendorCode: string, supplierName: string): string {
  return `${vendorCode}::${supplierName}`
}

/**
 * 供应商单位索引：把「一行数据属于哪几个供应商单位」这件事封装成 resolve()，
 * 业务侧（供应商日报、司机地图、区域地图…）不再各自拼 vendorCode / routeCode 过滤条件。
 * 判定本身仍然只有 isRowInConfigScope 一处实现，这里只负责按 vendorCode / routeCode 建索引提速。
 */
export type SupplierUnitIndex = {
  units: Map<string, SupplierUnit>
  /** 该行落在哪些供应商单位上（0 个 = 不属于任何已配置供应商；多个 = 多家共担同一路由，各自计各自的） */
  resolve(rowVendorCode: unknown, rowRouteCode: unknown): string[]
  /**
   * 同 resolve，但不做路由码白名单剔除。
   * 给「白名单不参与剔除」的口径用：揽收量（客诉率分母，分子客诉量本就不按白名单过滤，
   * 分母剔除会让两者口径不一致、虚高客诉率）、以及司机归属判定（司机属于哪家与白名单无关）。
   */
  resolveIgnoringWhitelist(rowVendorCode: unknown, rowRouteCode: unknown): string[]
}

export function buildSupplierUnitIndex(configs: SupplierUnitConfigRow[]): SupplierUnitIndex {
  const units = new Map<string, SupplierUnit>()
  for (const config of configs) {
    const vendorCode = normCode(config.vendorCode)
    if (!vendorCode) continue
    const supplierName = supplierDisplayName(config)
    const supplierKey = buildSupplierUnitKey(vendorCode, supplierName)
    const unit = units.get(supplierKey) ?? {
      supplierKey,
      supplierName,
      vendorCode,
      routeCodes: new Set<string>(),
      routeCodeWhitelist: new Set<string>(),
    }
    for (const code of parseRouteCodes(config.routeCode ?? '')) unit.routeCodes.add(code)
    for (const code of parseRouteCodes(config.routeCodeWhitelist ?? '')) unit.routeCodeWhitelist.add(code)
    units.set(supplierKey, unit)
  }
  return buildIndexFromUnits(units)
}

/** 从已解析好的单位集合建索引（供 worker 侧从任务 payload 还原时复用，不重复归并逻辑） */
export function buildIndexFromUnits(units: Map<string, SupplierUnit>): SupplierUnitIndex {
  const keysByVendorCode = new Map<string, string[]>()
  const keysByRouteCode = new Map<string, string[]>()
  for (const unit of units.values()) {
    const byVendor = keysByVendorCode.get(unit.vendorCode) ?? []
    byVendor.push(unit.supplierKey)
    keysByVendorCode.set(unit.vendorCode, byVendor)
    // 承运商未回填时按路由码兜底归属，与 isRowInConfigScope 的兜底分支对应
    for (const routeCode of unit.routeCodes) {
      const byRoute = keysByRouteCode.get(routeCode) ?? []
      byRoute.push(unit.supplierKey)
      keysByRouteCode.set(routeCode, byRoute)
    }
  }

  const resolveWith = (
    rowVendorCode: unknown,
    rowRouteCode: unknown,
    applyWhitelist: boolean,
  ): string[] => {
    const vendorCode = normCode(rowVendorCode)
    const routeCode = normCode(rowRouteCode)
    // 先用索引取候选（同 vendorCode 通常只有 1～2 个单位），再逐个走唯一的归属判定精筛
    const candidates = vendorCode
      ? (keysByVendorCode.get(vendorCode) ?? [])
      : (keysByRouteCode.get(routeCode) ?? [])
    if (candidates.length === 0) return []
    return candidates.filter((key) => {
      const unit = units.get(key)
      if (!unit) return false
      const scope = {
        vendorCode: unit.vendorCode,
        routeCodes: unit.routeCodes.size > 0 ? unit.routeCodes : undefined,
        routeCodeWhitelist: unit.routeCodeWhitelist.size > 0 ? unit.routeCodeWhitelist : undefined,
      }
      return applyWhitelist
        ? isRowInConfigScope(scope, vendorCode, routeCode)
        : isRowInConfigScopeIgnoringWhitelist(scope, vendorCode, routeCode)
    })
  }

  return {
    units,
    resolve: (rowVendorCode, rowRouteCode) => resolveWith(rowVendorCode, rowRouteCode, true),
    resolveIgnoringWhitelist: (rowVendorCode, rowRouteCode) =>
      resolveWith(rowVendorCode, rowRouteCode, false),
  }
}

/**
 * 供应商单位 → 逐单位独立范围（key = supplierKey），供各聚合器的 byScopes 接口消费。
 * 「11点前出仓告警」「24H派签告警」按推送配置 id 分桶，「供应商日报」按供应商单位分桶，
 * 两者用的是同一个 byScopes 聚合器、同一套归属判定，只是 key 的含义不同。
 */
export function supplierUnitsToScopes(index: SupplierUnitIndex): ConfigScope[] {
  return [...index.units.values()].map((unit) => ({
    key: unit.supplierKey,
    vendorCode: unit.vendorCode,
    routeCodes: unit.routeCodes.size > 0 ? unit.routeCodes : undefined,
    routeCodeWhitelist: unit.routeCodeWhitelist.size > 0 ? unit.routeCodeWhitelist : undefined,
  }))
}

/** 供应商单位的 JSON 可序列化形式：随分析任务 payload 冻结，worker 侧再还原成索引 */
export type SupplierUnitRecord = {
  supplierKey: string
  supplierName: string
  vendorCode: string
  routeCodes: string[]
  routeCodeWhitelist: string[]
}

export function serializeSupplierUnits(index: SupplierUnitIndex): SupplierUnitRecord[] {
  return [...index.units.values()]
    .map((unit) => ({
      supplierKey: unit.supplierKey,
      supplierName: unit.supplierName,
      vendorCode: unit.vendorCode,
      routeCodes: [...unit.routeCodes].sort(),
      routeCodeWhitelist: [...unit.routeCodeWhitelist].sort(),
    }))
    .sort((a, b) => (a.supplierKey < b.supplierKey ? -1 : a.supplierKey > b.supplierKey ? 1 : 0))
}

export function parseSupplierUnits(raw: unknown): SupplierUnitIndex {
  const units = new Map<string, SupplierUnit>()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const record = item as Partial<SupplierUnitRecord>
      const supplierKey = normCode(record.supplierKey)
      const vendorCode = normCode(record.vendorCode)
      if (!supplierKey || !vendorCode) continue
      units.set(supplierKey, {
        supplierKey,
        supplierName: normCode(record.supplierName),
        vendorCode,
        routeCodes: new Set(Array.isArray(record.routeCodes) ? record.routeCodes.map(normCode).filter(Boolean) : []),
        routeCodeWhitelist: new Set(
          Array.isArray(record.routeCodeWhitelist)
            ? record.routeCodeWhitelist.map(normCode).filter(Boolean)
            : [],
        ),
      })
    }
  }
  return buildIndexFromUnits(units)
}

type ScopeConfigRow = Pick<FleetSupplierPushConfig, 'vendorCode' | 'routeCode' | 'routeCodeWhitelist'>

/**
 * 单条推送配置 → 独立范围。告警逐配置推送；同 vendorCode 不同 routeCode 的多条配置
 * 各自独立统计，互不混算。routeCode 为空时不建纳入条目（= 不收窄），与分析侧合并语义一致。
 */
export function buildScopeMapsFromConfig(config: ScopeConfigRow): VendorScopeMaps {
  const scope: VendorScopeMaps = { routeCodesByVendor: new Map(), routeCodeWhitelistByVendor: new Map() }
  const vendorCode = normCode(config.vendorCode)
  if (!vendorCode) return scope
  const routeCodes = new Set(parseRouteCodes(config.routeCode ?? ''))
  const whitelist = new Set(parseRouteCodes(config.routeCodeWhitelist ?? ''))
  if (routeCodes.size > 0) scope.routeCodesByVendor.set(vendorCode, routeCodes)
  if (whitelist.size > 0) scope.routeCodeWhitelistByVendor.set(vendorCode, whitelist)
  return scope
}

/**
 * 单条推送配置 → ConfigScope（逐配置推送的告警都用它构造，业务侧不许再手搓）。
 * vendorCode 允许为空：那是「只按路由码匹配」的配置，归属判定里走纯路由码分支。
 */
export function buildConfigScope(key: string, config: ScopeConfigRow): ConfigScope {
  const routeCodes = new Set(parseRouteCodes(config.routeCode ?? ''))
  const whitelist = new Set(parseRouteCodes(config.routeCodeWhitelist ?? ''))
  return {
    key,
    vendorCode: normCode(config.vendorCode),
    routeCodes: routeCodes.size > 0 ? routeCodes : undefined,
    routeCodeWhitelist: whitelist.size > 0 ? whitelist : undefined,
  }
}

/**
 * 多条配置 → 按 vendorCode 取并集（「供应商数据分析」整体口径）。
 * 返回 JSON 可序列化形式，供任务 payload 冻结；worker 侧再解析回 VendorScopeMaps。
 */
export function buildScopeRecordsFromConfigs(configs: ScopeConfigRow[]): {
  routeCodesByVendor: Record<string, string[]>
  routeCodeWhitelistByVendor: Record<string, string[]>
} {
  const routeCodesByVendor: Record<string, string[]> = {}
  const routeCodeWhitelistByVendor: Record<string, string[]> = {}
  const mergeInto = (target: Record<string, string[]>, vendorCode: string, codes: string[]) => {
    if (codes.length === 0) return
    const merged = new Set(target[vendorCode] ?? [])
    for (const code of codes) merged.add(code)
    target[vendorCode] = [...merged]
  }
  for (const config of configs) {
    const vendorCode = normCode(config.vendorCode)
    if (!vendorCode) continue
    mergeInto(routeCodesByVendor, vendorCode, parseRouteCodes(config.routeCode ?? ''))
    mergeInto(routeCodeWhitelistByVendor, vendorCode, parseRouteCodes(config.routeCodeWhitelist ?? ''))
  }
  return { routeCodesByVendor, routeCodeWhitelistByVendor }
}
