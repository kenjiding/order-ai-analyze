import type { AiLossScope, AnalyzeTarget, OrderAnalyzeResult } from './types'
import { computeTrackTemporalContext, summarizeTracks } from './trackFacts'
import { buildFactGuardrailPromptText } from './decisionRules'
import {
  getConfiguredSystemOperatorNames,
  DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS,
  EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS,
} from './warehouseProfiles'
import {
  AI_LOSS_SCOPE_VALUES,
  buildLossScopePromptText,
  buildSubTypePromptText,
  normalizeLossScope,
  normalizeSubType,
} from './exceptionCatalog'

function normalizeParsedLossScope(raw: unknown): AiLossScope {
  return normalizeLossScope(raw)
}

function clampConfidence(raw: unknown): number {
  const parsed = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.parseFloat(String(raw ?? ''))
  if (!Number.isFinite(parsed)) return 0
  if (parsed < 0) return 0
  if (parsed > 1) return 1
  return parsed
}

function makeFallbackAnalyzeResult(orderNo: string, reason: string): OrderAnalyzeResult {
  return {
    orderNo,
    lossScope: '需人工判断',
    exceptionCategoryId: '',
    reason,
    confidence: 0,
    needsReview: true,
  }
}

export function parseOrderAnalyzeResults(
  rawContent: string,
  targets: AnalyzeTarget[]
): OrderAnalyzeResult[] {
  let parsed: { results?: unknown[] }
  try {
    parsed = JSON.parse(rawContent) as { results?: unknown[] }
  } catch {
    return targets.map((target) => makeFallbackAnalyzeResult(target.orderNo, '模型返回非 JSON，无法稳定解析该订单分析结果。'))
  }
  const rows = Array.isArray(parsed.results) ? parsed.results : []
  const parsedByOrder = new Map<string, OrderAnalyzeResult>()
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const orderNo = String(o.orderNo ?? '').trim()
    if (!orderNo || !targets.some((t) => t.orderNo === orderNo)) continue
    const lossScope = normalizeParsedLossScope(o.lossScope)
    const reason = String(o.reason ?? '').trim()
    const exceptionCategoryId = normalizeSubType({
      lossScope,
      subType: String(o.exceptionCategoryId ?? ''),
    })
    parsedByOrder.set(orderNo, {
      orderNo,
      lossScope,
      exceptionCategoryId,
      reason: reason || '模型未提供分析原因。',
      confidence: clampConfidence(o.confidence),
      needsReview: lossScope === '需人工判断' || !reason,
    })
  }

  return targets.map((target) => {
    const parsedRow = parsedByOrder.get(target.orderNo)
    return parsedRow ?? makeFallbackAnalyzeResult(target.orderNo, '模型未返回该订单分析结果，已进入人工复核兜底。')
  })
}

export function prepareAnalyzeCategories(input: { targets: AnalyzeTarget[] }) {
  const systemEventOperatorNames = getConfiguredSystemOperatorNames().join('、')

  const targetText = input.targets
    .map((t) => {
      const temporalContext = computeTrackTemporalContext(t.tracks, t.interceptLogs ?? [], {
        analysisDate: t.analysisDate,
      })
      return `订单 ${t.orderNo}:\n${temporalContext}\n\n[轨迹事件]\n${summarizeTracks(t.tracks, 14)}`
    })
    .join('\n\n---\n\n')

  const systemPromptBase = [
    '## 角色: 你是跨境/仓配异常研判助手，只依据物流轨迹文本做判断。',
    '## 必须先判断丢失责任类型，输出必须是以下六者之一（禁止用其它文案）：',
    buildLossScopePromptText(),
    '## 核心原则：责任方 = 轨迹与阻断日志合并到同一条时间线后，最后一条真实操作所在的仓；库内操作归库内、库外操作归库外，并基于「时序分析」中该仓的丢失超时阈值从该操作时间起算重新判断；最后用「承运商完结标记」做一致性校验或置信度微调。事实优先，责任点不得越过终态（销毁/暂存/退返商家闭环/正常完结）等更高优先级规则。',
    '真实操作员、非真实账号和系统账号已由服务端按「当前责任仓库配置」用排除法完成确定性识别；模型只允许使用「时序分析」中的预计算字段，不得自行解析账号名、前缀或仓库规则重判。',
    '## 服务端硬规则目录（模型需与服务端确定性校验保持一致）：',
    buildFactGuardrailPromptText(),
    '若同时涉及多段，按主责或最终指向选择最贴切的一项。',
    '除 lossScope 外，还需输出子类型（字段名保持为 exceptionCategoryId，用于兼容既有接口）。',
    '子类型必须从系统内置目录中选择，不允许自由编造；若该类型当前无子类型，返回空字符串 ""。',
    '---',
  ].join('\n')

  const userPrompt = [
    '## 判断流程（按步骤依次执行）',
    '',
    '### Step 1：识别操作员类型',
    '- 操作员类型已由服务端按「当前责任段」和「当前责任仓库配置」预计算完成；模型禁止自行解析账号名前缀、仓库画像或历史仓库规则。',
    '- 判断库内/库外/虚假转运时，只能读取「时序分析」中的服务端字段：当前责任主体、当前仓库、仓库配置状态、真实操作员扫描记录、库内起算时间、库外起算时间、分配-取消循环、最近一次出库后回站/盘点等。',
    '- 「真实操作员扫描记录: 是」只表示当前责任段存在服务端确认的仓内真实人工扫描/盘点；「包裹正在派送中」二次出库扫描不计入仓内真实扫描。',
    '- 悉尼分拣机与内部仓规则已由服务端预计算：轨迹同时出现「操作员/操作人【sorter】」与「设备编码[...]」或「实际格口号为【...】」时视为仓内真实扫描；「SYD Warehouse数字」「NSYD W数字」也作为 Sydney/SYDN 仓内真实扫描/到仓证据。',
    '- 库外责任以「包裹正在派送中」事件语义为准：只要当前责任段存在该真正出库事件且最近一次出库后未回仓/盘点，就表示责任已转移到库外，不得再按账号名前缀把该事件当成库内扫描。',
    '- 当前仓库未匹配配置时，禁止默认把操作员视为真实操作员；若结论依赖真实操作员，应输出「需人工判断」。',
    '- 注意：当前责任段仅出现非真实/系统/未知操作员时，不能判定为库内责任（包裹未真正人工扫描入库）',
    '',
    '### Step 2：读取时序分析（重要）',
    '- 每个订单的「[时序分析]」字段由服务端预先计算，「距今天数」已给出，直接使用，禁止自行从时间戳推算',
    `- 「当前仓库丢失超时阈值」由服务端按当前责任仓库配置给出；未配置仓库使用默认 ${DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS} 天。库内/库外丢失阈值必须读取该字段，禁止固定写死天数。`,
    '- 「当前最新事件」字段是最后一条轨迹的事件摘要，必须以此判断"当前状态"，不得使用历史轨迹中的中间事件',
    '- 「当前责任段」由服务端根据装箱集包、到达仓库、转交外部承运、派送出库、回站/盘点、阻断日志扫描网点等轨迹与阻断日志合并确定；库内/库外判断只能使用当前责任段字段，禁止混用历史责任段的起算时间、扫描员或分配-取消循环',
    '- 「阻断日志责任点」字段若存在，服务端已按扫描网点把它并入对应仓库责任段（可凭它确定/切换责任仓）；最终库内/库外责任以「当前责任段最终责任点」为准；不得用于反转终态闭环、虚假转运或暂无异常闭环',
    '',
    '- **关键概念区分（依据仓库正确流程）**：',
    '  · 「派送任务已分配给派件员」≠ 出库（包裹仍在仓内，等待派送员二次扫描）',
    '  · 「包裹正在派送中」/ trackType=delivery = **真正出库**（派送员二次扫描成功，责任转移到库外）',
    '  · 「取消分配」/「撤销分配」= 任务作废，包裹仍在仓内',
    '  · 「已回到网点」+「已盘点」= 包裹回仓，责任重新归仓内',
    '  · 「【AAAA】已装箱（集包），目的地【BBBB】」= 起始仓 AAAA 的最后一次库内真实操作；在 BBBB 出现真实操作（轨迹「已到达/已收到退件」或阻断日志扫描网点=BBBB 的真实扫描）之前，责任仍留在 AAAA，按 AAAA 库内阈值判断；不要据此判「暂无异常」或「需人工判断」',
    '  · 「【X】已收到退件包裹」或阻断日志扫描网点=X 的真实扫描 = 责任已切换到 X 仓，后续必须按 X 仓库内/库外流程继续判断',
    '  · Sydney Center 分拣后发往 SYDN 等悉尼内部仓仍属于公司库内责任流转；到达下游仓后继续按当前仓库库内/库外规则判断，相关 sorter / SYD Warehouse数字 / NSYD W数字 节点可重置库内起算时间',
    '  · 「商家已反馈NDR处理意见[退返商家]」或「包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理」= 商家给出退返方向，不是仓库真实操作、不是库内责任点、不是退返闭环；若它仍是当前最新有效商家处理方向且尚未闭环，lossScope 为「暂无异常」时子类型使用「退返商家」；一旦出现「退件已退返商家」等物理闭环则改用「已退返商家」。起算分两种路径：① 该退返之前该单并无暂存 → 不得重置库内/库外起算，仓库已累积的滞留照常追责；② 该退返释放的是暂存冻结 → 冻结期间未累积仓库责任，从退返事件重新起算，阈值改用「分析配置」的退返商家时效，超期子类型为「退返超时」',
    '  · 「商家已反馈退件销毁处理意见[Abandon]」或「商家已反馈NDR处理意见[Abandon]」= 商家给出 Abandon 销毁指令，属于「商家反馈」方向，不是退返闭环、不是库内操作；只要它是最新商家反馈就直接判「暂无异常」，子类型「Abandon销毁」，与该单此前已滞留多少天无关（销毁后不会再有扫描，不得用「指令后无扫描」或「已超阈值」反推该指令无效）；不得归入退返方向或退返商家子类型',
    '  · 「退件已销毁」= Abandon 销毁物理闭环信号，表示包裹已实际销毁，该订单完全闭环；子类型仍为「Abandon销毁」',
    '  · 商家处理方向（暂存 / Abandon销毁 / 退返商家）是同一类状态：包裹已脱离正常履约、由商家指令接管，都不适用库内/库外超时；常见走向是先暂存、再转销毁或退返，也可能一直暂存或直接销毁',
    '  · 商家反馈存在叠加时，以最新反馈为准：若 Abandon 晚于暂存和退返事件，以 Abandon 为准；若暂存晚于 Abandon，以暂存为准；以此类推',
    '  · 任一商家方向的失效条件只有一个——包裹回到履约流程（「预约派送」「包裹正在派送中」「派送任务已分配给派件员」）；此时方向作废，恢复当前责任段的库内/库外超时判断',
    '  · 装箱集包转运到任意目的地（公司仓 / 3PL / 商家退返地址）都只是"责任转移到目的地"，本身不是终态；但若当前最新有效商家处理方向仍为退返/退回商家，lossScope 为「暂无异常」时子类型仍使用「退返商家」',
    '  · 仓库名前缀只表示该轨迹显示的业务地点，不等于物理转仓；「登记问题件」「已进入NDR」「商家反馈」「包裹确认派送结束」不得单独触发仓库责任段切换',
    `  · 「【X】包裹已转交至【承运商】进行承运」= X 仓库责任结束，当前责任转为外部承运商；外部承运不是我司库内/库外责任，最后更新未达到 ${EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS} 天复核阈值时判「暂无异常」，达到 ${EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS} 天时判「3PL丢件」`,
    '  · 「商家反馈意见[暂存]」= 暂存冻结库内/库外时钟；除非后续出现新的商家方向（退返/Abandon）或包裹回到履约流程（「预约派送」「包裹正在派送中」「派送任务已分配给派件员」），否则完全没有超时逻辑，滞留多久都判「暂无异常」，后续普通盘点/收退件不改变暂存结论、也不需要靠盘点来续命（暂存后的盘点本就是为了把要退返的包裹挑出来）',
    '  · ⚠️ **极易误判**：若「最近一次出库后已有回站/盘点记录」= 是（包裹已回仓），则责任已重置为库内；此后新发起的「派送任务已分配」→「取消分配」**不**算作「全程无出库的分配-取消循环」，必须以预计算字段「分配-取消循环（无任何成功出库）」的值为准，禁止凭原始轨迹中存在取消记录就自行认定该字段为是',
    '',
    '- 「库内起算时间」= 当前责任段责任点时间线中最近一个库内责任点；只允许来自真实仓库责任点，如真实操作员扫描、已到达、已回到网点、已盘点、已归班、已下架、悉尼分拣/内部转仓真实扫描、阻断日志当前仓库扫描员。',
    '- 「库外起算时间」= 当前责任段责任点时间线中最近一个库外责任点；只允许来自「包裹正在派送中」二次扫描或阻断日志派送员责任点，**不使用「派送任务已分配」**。',
    '- 「库内起算时间之后已真正出库」= 仅当当前责任段责任点时间线中存在晚于库内责任点的库外责任点才为"是"；分配但被取消、商家退返方向、NDR、问题件登记均不算出库。',
    '',
    '### Step 3：判定 lossScope —— 严格按 3a → 3b → 3c 分层执行',
    '',
    '#### 3a-0. 终态先行门槛（最高优先级）',
    '若轨迹出现以下任一闭环信号：',
    '· 最新轨迹为「订单异常完结，原因【xxxxx】。操作员【xxxx】」格式',
    '· 「商家已反馈NDR处理意见[销毁]」',
    '· 「包裹确认派送结束, 将按照商家反馈意见[销毁]进行处理」',
    '· 「商家已反馈退件处理意见[Abandon]」或「商家已反馈NDR处理意见[Abandon]」（Abandon 为英文关键字，与销毁语义等同），且该事件是当前最新商家反馈',
    '· 「已发起拦截，拦截原因[销毁]，拦截处理意见[销毁]」（操作员发起拦截，拦截原因为销毁/Abandon），文案家族与商家反馈不同但语义等同',
    '· 「退件已销毁」（物理销毁闭环，表示包裹已实际销毁，与 Abandon 指令配合使用）',
    '· 「退返商家闭环: 是」、轨迹明确显示「退件已退返商家」、退回发件方/商家签收、退货妥投、退款退货闭环',
    '· 「商家已反馈NDR处理意见[暂存]」或「包裹确认派送结束, 将按照商家反馈意见[暂存]进行处理」，且后续没有「预约派送」或明确业务推进（如「商家已反馈退件处理意见」「已装箱，目的地【X】」）轨迹',
    '则直接判定 lossScope = 「暂无异常」；reason 使用对应终态短词。',
    '其中「订单异常完结」命中时，reason 建议包含短词「订单已完结」，子类型必须使用「订单已完结」。仅历史轨迹出现但后续已有新轨迹时，不使用该规则。',
    '其中「Abandon销毁」命中时（无论是 Abandon 指令还是退件已销毁），reason 建议包含短词「Abandon销毁」，子类型必须使用「Abandon销毁」；中文「销毁」指令也统一使用「Abandon销毁」子类型。',
    '其中「退返商家闭环」命中时，reason 建议包含短词「已退返商家」，子类型必须使用「已退返商家」；未闭环的退返方向才用「退返商家」，两者不得混用。',
    '注意：「商家已反馈NDR处理意见[退返商家]」「包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理」「商家已反馈退件处理意见[退回商家]」仅表示商家给出退返/退回商家方向，不是终态闭环、不是库内/库外责任点；若该方向仍为当前最新有效商家处理方向且尚未出现退返物理闭环，lossScope 为「暂无异常」时子类型必须使用「退返商家」（已闭环的用「已退返商家」）。若最终责任点已超阈值，仍按库内/库外超时判断。若后续最新处理方向改为 Abandon/销毁/暂存/Transfer/RTC 等，以最新方向为准覆盖旧方向。',
    '注意：「商家已反馈退件处理意见[Abandon]」不属于退返方向，不得归入退返商家；只要出现此指令且为最新商家反馈，直接使用「Abandon销毁」子类型。',
    '其中「暂存」命中时，reason 建议使用短词「暂存」，子类型建议使用「暂存」；暂存不适用库内/库外超时。',
    '若「暂存」之后又出现「预约派送」，则暂存状态释放，必须从最近一次「已盘点」重新起算，并按当前仓库丢失超时阈值回到正常的库内丢失/库外丢失判断。',
    '若「暂存」之后出现「商家已反馈退件处理意见」「已装箱，目的地【X】」等明确业务推进，则暂存状态释放，子类型不得继续使用「暂存」，必须回到当前责任段最终责任点与当前仓库阈值继续判断。',
    '暂存释放不是终态闭环，不得高于库内/库外超时与分配-取消循环判定。',
    '',
    '#### 3a-0b. 责任段切换门槛（次高优先级）',
    `若「当前责任主体」= external_carrier，且最后更新距今 < ${EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS} 天：`,
    '· 说明公司仓库已完成外部承运交接，且外部承运未达到复核阈值；直接判定为「暂无异常」；reason 建议使用短词「已转交外部承运」。',
    `若「当前责任主体」= external_carrier，且最后更新距今 ≥ ${EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS} 天：`,
    '· 不得判我司「库内丢失」或「库外丢失」；公司仓库责任已完成外部承运交接，直接判定为「3PL丢件」。',
    '装箱集包转运中（起始仓已装箱、目的仓尚未产生真实操作）：责任仍在起始仓，按起始仓库内阈值判断，不要据此输出「暂无异常」或「需人工判断」。',
    '',
    '#### 3a. 仅依据轨迹事实独立判定 lossScope',
    '此阶段**完全忽略**「订单异常完结」中的承运商结论（包括 station_loss / 站内丢包等关键词）。',
    '只依据当前责任段内的：最终责任点归属、最终责任点距今天数、是否真实扫描入库、是否真正出库、是否有正常完结、是否分配-取消循环未出库。',
    '',
    '##### 3a-前置：真实扫描硬门槛（必须最先判断，优先于库内/库外/虚假转运的细分条件）',
    '- 核心判别字段为「真实操作员扫描记录」：它仅在当前责任段存在服务端确认的真实人工入库扫描/盘点/回仓/sorter/悉尼内部扫描时才为「是」；非真实账号、系统账号执行的盘点/回仓不计入，「派送任务已分配」「包裹正在派送中」二次出库扫描也不计入。',
    '- 若「真实操作员扫描记录: 否」，且当前责任段**无**「包裹正在派送中」真正出库、**无**阻断日志派送员责任点（责任既未真正人工入库、也未真正出库）：',
    '  · 若「分配-取消循环（无任何成功出库）」= 是 → **直接判定「虚假转运」**（包裹只是反复被分配又取消，从未真正被人工扫描入库或派送出库）；**禁止判「库内丢失」/「库外丢失」**。',
    '  · 否则 → 判定「需人工判断」（无真实责任落点且无分配-取消循环证据）。',
    '- 只有当「真实操作员扫描记录: 是」，或当前责任段存在「包裹正在派送中」真正出库 / 阻断日志派送员责任点时，才继续进入下方「库内丢失/库外丢失」细分判定。',
    '',
    '##### 「库内丢失」事实判定：',
    '必要条件（全部满足，缺一不可，任一不满足立即排除库内丢失）：',
    '① 「真实操作员扫描记录: 是」（当前责任段存在服务端确认的真实人工入库扫描/盘点/回仓/sorter/悉尼内部扫描）。**若「真实操作员扫描记录: 否」，则①不满足 → 禁止判库内丢失**（按 3a-前置走「虚假转运」或「需人工判断」）；非真实/系统账号执行的盘点、回仓不算真实入库扫描，即使「当前责任段最终责任点」显示为库内也不例外。',
    '② 「库内起算时间之后已真正出库」= 否（即从无「包裹正在派送中」事件，或出库后已回站/盘点）',
    '③ 无「已签收」「妥投」「派件完成」等正常完结记录',
    '充分条件（在①②③全部满足的前提下，必须满足）：',
    '④ 最终责任点为库内，且「最终责任点距今天数」≥ 「当前仓库丢失超时阈值」',
    '    · 「当前最新事件」可为「已盘点（在库）」「派件员已回到网点（在库）」「派送任务已取消（仍在库内）」「派送任务已分配（在库内待派送员二次扫描出库）」「订单异常完结」等任意"非派送中、非完结"状态，**不强制要求最新事件必须是回站/盘点**',
    '    · 商家给出退返方向但未闭环、且尚未出现退返集包号时，不改变最终责任点；若最终责任点仍为库内且超阈值，可按库内超时判断',
    '⚠️ 关键澄清：「分配-取消循环（库内起算之后无成功出库）」**绝不**是库内丢失的独立判定条件，也**不能**降低或替代④的天数阈值。',
    '   即使循环次数再多，只要「最终责任点距今天数」< 「当前仓库丢失超时阈值」，**一律不得判库内丢失**，应判「暂无异常」。',
    '   该字段只用于在④已满足时区分子类型：**最后一次库内实物确认（回仓/盘点/入库扫描）之后**出现过「分配→取消」配对（1 组即算）且此后无出库 =是 → 「疑似派件员窃取」；=否 → 「扫描员丢失」。',
    '   ⚠️ 回仓/盘点/入库扫描会重置起算点：发生在该点之前的分配-取消，说明包裹此后仍被实物确认在仓，相关派件员已被洗清嫌疑，不得据此判「疑似派件员窃取」。',
    '   **若「真实操作员扫描记录: 否」，即使存在分配-取消循环且最终责任点距今超阈值，也属于「虚假转运」而非库内丢失。**',
    '',
    '##### 「库外丢失」事实判定（必要 + 充分条件全部满足）：',
    '① 当前责任段存在「包裹正在派送中」二次扫描事件（真正出库；以事件语义为准，不依赖操作员账号名前缀）',
    '② 当前责任主体仍为 company_warehouse，且当前责任状态为 out_warehouse',
    '③ 「最近一次出库后已有回站/盘点记录」= 否（包裹仍在库外）',
    '④ 最终责任点为库外，且「最终责任点距今天数」≥ 「当前仓库丢失超时阈值」',
    '⑤ 无「已签收」「妥投」等正常完结记录',
    '',
    '##### 「3PL丢件」事实判定（必要条件全部满足）：',
    '① 当前责任主体为 external_carrier',
    '② 公司仓库已出现「包裹已转交至【承运商】进行承运」或同等外部承运交接事实',
    `③ 最后更新距今 ≥ ${EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS} 天`,
    '④ 后续未出现签收/妥投等正常完结，也未重新进入公司仓库责任段',
    '',
    '##### 「虚假转运」事实判定（必要条件全部满足）：',
    '① 预计算字段「分配-取消循环（无任何成功出库）」= 是（轨迹存在连续多次[分配任务→取消分配]循环，且全程无「包裹正在派送中」真正出库）',
    '② 「真实操作员扫描记录: 否」（当前责任段全程无真实操作员扫描/盘点/回仓入库；非真实账号、系统账号的操作不计入，以服务端预计算字段为准，禁止按账号文本自行排除或纳入）',
    '③ 当前责任段无「包裹正在派送中」真正出库、也无阻断日志派送员责任点（即无任何库外责任点）',
    '⚠️ 只要「真实操作员扫描记录: 是」（存在真实人工扫描/盘点/回仓入库），立即排除虚假转运，转入库内判定。',
    '',
    '##### 「暂无异常」事实判定：',
    '· 若最新轨迹出现「订单异常完结，原因【xxxxx】。操作员【xxxx】」：优先判定为「暂无异常」，exceptionCategoryId 输出「订单已完结」',
    '· 若轨迹出现「签收成功」「已签收」「妥投」「派件完成」等正常履约完结：判定为「暂无异常」，exceptionCategoryId 输出「已签收」；商家 Abandon/退返/暂存指令之后仍出现该完结的（事实字段「晚于最新商家处理方向: 是」），以签收为准输出「已签收」，不得沿用商家方向子类型；仅当该完结早于最新商家处理方向时，才使用商家方向对应子类型',
    '· 若轨迹出现「商家已反馈NDR处理意见[销毁]」「包裹确认派送结束并按商家销毁意见处理」等明确销毁闭环信号：优先判定为「暂无异常」，子类型「Abandon销毁」；reason 建议包含短词「商家已确定销毁」',
    '· 若轨迹出现「商家已反馈退件处理意见[Abandon]」「商家已反馈NDR处理意见[Abandon]」「退件已销毁」等 Abandon 信号，且该信号是最新商家反馈：优先判定为「暂无异常」，子类型「Abandon销毁」；禁止将 Abandon 归为退返方向或退返商家',
    '· 若轨迹出现「已发起拦截，拦截原因[销毁]」或「拦截原因[Abandon]」（操作员发起拦截，拦截原因为销毁/Abandon），且该信号是当前最新方向：优先判定为「暂无异常」，子类型「Abandon销毁」',
    '· 若轨迹明确显示「退件已退返商家」、退回发件方/商家签收、退货妥投、退款退货闭环等退返完成信号：包裹已物理回到商家，判定为「暂无异常」，exceptionCategoryId 输出「已退返商家」；即使退返耗时超过退返商家时效，闭环后也不再标记超期',
    '· 若轨迹出现「商家反馈意见[暂存]」或「包裹确认派送结束并按商家暂存意见处理」，且后续没有「预约派送」或明确业务推进：优先判定为「暂无异常」；reason 建议包含短词「暂存」；后续普通盘点/收退件/超过当前仓库阈值不改变结论',
    '· 「商家已反馈NDR处理意见[退返商家]」「包裹确认派送结束并按退返商家意见处理」「商家已反馈退件处理意见[退回商家]」若仍是当前最新有效商家处理方向，未超当前仓库阈值时可判「暂无异常」且子类型使用「退返商家」；若最新方向变为 Transfer/RTC/Abandon/销毁/暂存等，则不得沿用旧的「退返商家」子类型',
    '· 退返方向后出现「已装箱，集包号[...]，目的地【X】」仅是责任转移到 X，不是退返闭环；责任仍按起始仓（X 未产生真实操作时）或 X 仓（已产生真实操作时）库内阈值判断；lossScope 为「暂无异常」且最新有效方向仍为退返/退回商家时，子类型使用「退返商家」',
    '· 若「暂存」之后又出现「预约派送」：不得继续按暂存判「暂无异常」，需从最近一次「已盘点」开始恢复当前仓库阈值判断',
    '· 若「暂存」之后出现「商家已反馈退件处理意见」「已装箱，目的地【X】」等明确业务推进：不得继续使用「暂存」子类型，必须回到当前责任段最终责任点与当前仓库阈值判断；若最终责任点已超阈值，仍应判库内/库外丢失',
    `· 若当前责任主体为外部承运商且最后更新未达到 ${EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS} 天复核阈值：判定为「暂无异常」；reason 建议包含短词「已转交外部承运」`,
    '· 所有确定性异常、复核、闭环和责任转移规则均不命中，且不存在关键证据缺失',
    '',
    '##### 「需人工判断」事实判定：',
    '· 仍在库内/库外责任域内的边界单：如关键节点缺失、证据互相冲突，无法稳定判定是库内还是库外',
    '· 当前责任主体不是 external_carrier 时，不得输出「3PL丢件」；若模型无法稳定归类，输出「需人工判断」',
    '· 已明确责任转移出本站且未达到复核/超时阈值的订单，不归入「需人工判断」',
    '',
    '#### 3b. 按责任点时间线确定最终责任归属与最终起算时间',
    '只有在 3a 已基于正常轨迹确认当前处于库内/库外责任域后，才读取「当前责任段最终责任点」字段；终态闭环、虚假转运等高优先级结论不被阻断日志反转。',
    `- 阻断日志操作人类型已由服务端按 scanUserCode、scanUserName 与当前仓库配置完成识别；系统自动事件账号（当前系统自动事件账号：${systemEventOperatorNames || '无'}）不参与真实操作员责任点。`,
    '- 未被服务端识别为派送员或仓库真实操作员的阻断日志，视为未知操作人，不参与最终责任起算更新。',
    '- 服务端已将正常轨迹责任点与所有有效阻断日志责任点按时间合并；模型不得自行使用库内起算/库外起算重新覆盖「当前责任段最终责任点」。',
    '- 阻断日志扫描员是库内责任点；阻断日志派送员是库外责任点；未知操作人不进入责任点时间线。',
    '- 谁是当前责任段内最后一个有效责任点，最终责任就归谁。',
    '- 得到最终责任归属与最终起算时间后，必须重新判断当前仓库丢失超时阈值：最终库内责任起算达到该阈值才判「库内丢失」；最终库外责任起算达到该阈值才判「库外丢失」；未满阈值则不得判库内/库外丢失。',
    '- 若「最近一次出库后已有回站/盘点记录」= 是，只能说明该回仓/盘点时间点责任曾回到库内；若之后存在更晚的阻断日志派送员责任点，最终责任仍应按更晚的派送员责任点归库外。',
    '- reason 命中最终责任点更新时必须写明最终责任点时间、责任归属、依据和当前仓库阈值判断。',
    '',
    '#### 3c. 读取承运商完结标记作为辅助证据进行取舍',
    '只有在 3a 已得出初步结论后，才读取「承运商完结标记: 站内丢包(station_loss)」字段（若存在）。',
    '',
    '- 【一致性增强】3a 结论 = 「库内丢失」 且 承运商也标 station_loss：',
    '  → 维持库内丢失，confidence 提高（不超过 0.99）；reason 中可注明承运商标记一致',
    '- 【冲突 - 维持事实】3a 结论 = 「库外丢失」 但 承运商标 station_loss：',
    '  → 维持库外丢失，**不得反转**；confidence 不提高；reason 中说明"承运商标记与事实轨迹冲突，以「包裹正在派送中」实际出库证据为准"',
    '- 【冲突 - 维持事实】3a 结论 = 「虚假转运」（无任何真实扫描） 但 承运商标 station_loss：',
    '  → 维持虚假转运，**不得反转为库内丢失**；reason 中说明"承运商系统也可能因数据问题误标，包裹无真实扫描记录无法归库内"',
    '- 【边界倾斜】3a 处于 5 天至当前仓库超时阈值附近（事实信号偏弱） 且 承运商标 station_loss：',
    '  → 可向「库内丢失」倾斜，但 confidence 不高于 0.85；reason 须明确"基于承运商辅助判定"',
    '',
    '⚠️ 严禁仅凭承运商完结标记单独决定 lossScope；事实判定永远优先。',
    '',
    '#### 3d. 输出最终结果',
    '按 3a 正常轨迹责任 + 3b 阻断日志更新后的最终责任起算 + 3c 承运商标记调整后的结论输出 lossScope / reason / confidence。',
    '',
    '### Step 4：输出子类型（exceptionCategoryId）',
    '- 先根据 lossScope 确定可选子类型，再写入 exceptionCategoryId。',
    '- exceptionCategoryId 只能来自该 lossScope 对应的系统目录；禁止跨 lossScope 选择，禁止自由编造。',
    '- 若该 lossScope 当前无子类型，exceptionCategoryId 必须输出空字符串 ""。',
    '- 若模型无法稳定匹配目录中的任何子类型，也输出空字符串 ""，由服务端事实规则做最终归一。',
    '- 子类型目录与选择说明：',
    buildSubTypePromptText(),
    '',
    '## 待分析订单轨迹：',
    targetText,
  ].join('\n')

  return { systemPromptBase, userPrompt }
}

export type ExplainPromptItem = {
  orderNo: string
  deterministicLossScope: AiLossScope
  deterministicSubType: string
  deterministicReason: string
  temporalContext: string
  trackSummary: string
}

export function prepareExplainPrompt(input: { items: ExplainPromptItem[] }): {
  systemPrompt: string
  userPrompt: string
} {
  const systemPrompt = [
    '你是物流异常订单解释助手。',
    '你不能修改既定结论，只能补充更清晰、可审计的解释原因。',
    '输出必须为 JSON 对象，顶层字段 results 是数组。',
    '每项包含 orderNo（字符串）与 reason（字符串）。',
    'reason 需简洁、基于给定时序事实，禁止编造未提供信息。',
  ].join('\n')

  const userPrompt = [
    '请基于以下已确定判定结果，补充更易读的解释：',
    ...input.items.map((item) =>
      [
        `订单 ${item.orderNo}`,
        `既定判定: ${item.deterministicLossScope}`,
        `既定子类型: ${item.deterministicSubType || '无'}`,
        `既定原因: ${item.deterministicReason}`,
        '[时序分析]',
        item.temporalContext,
        '[轨迹摘要]',
        item.trackSummary,
      ].join('\n')
    ),
  ].join('\n\n---\n\n')

  return { systemPrompt, userPrompt }
}

export function parseOrderExplainResults(
  rawContent: string,
  orderNos: string[]
): Array<{ orderNo: string; reason: string }> {
  let parsed: { results?: unknown[] }
  try {
    parsed = JSON.parse(rawContent) as { results?: unknown[] }
  } catch {
    return []
  }

  const allowSet = new Set(orderNos)
  const mapped = new Map<string, string>()
  const rows = Array.isArray(parsed.results) ? parsed.results : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const value = row as Record<string, unknown>
    const orderNo = String(value.orderNo ?? '').trim()
    if (!orderNo || !allowSet.has(orderNo)) continue
    const reason = String(value.reason ?? '').trim()
    if (!reason) continue
    mapped.set(orderNo, reason)
  }

  return orderNos.map((orderNo) => ({ orderNo, reason: mapped.get(orderNo) ?? '' }))
}

/** DeepSeek 不支持 json_schema，仅用 json_object；系统提示须包含 “json” 并描述结构（官方 JSON mode 要求）。 */
export const DEEPSEEK_JSON_INSTRUCTION = [
  '',
  '你必须只输出一个 JSON 对象（不要使用 markdown 代码块包裹）。',
  `顶层字段 results 为数组；数组每一项包含 orderNo（字符串）、lossScope（只能是 ${AI_LOSS_SCOPE_VALUES.map((scope) => `「${scope}」`).join('、')} 之一）、exceptionCategoryId（字符串）、reason（字符串）、confidence（0~1 的数字）。`,
  'exceptionCategoryId 表示子类型：必须从系统内置目录中选择；若对应 lossScope 当前无子类型可用，返回空字符串 ""。',
  'results 必须覆盖上文「待分析订单轨迹」中出现的每一个订单号，且每个订单号恰好一条。',
].join('\n')

/** DeepSeek 解释链路只允许补充 reason，不能复用分析链路的 lossScope schema。 */
export const DEEPSEEK_EXPLAIN_JSON_INSTRUCTION = [
  '',
  '你必须只输出一个 JSON 对象（不要使用 markdown 代码块包裹）。',
  '顶层字段 results 为数组；数组每一项只包含 orderNo（字符串）与 reason（字符串）。',
  'reason 必须基于给定时序事实解释既定判定，禁止修改、暗示修改或新增判定结果。',
  'results 必须覆盖上文订单号，且每个订单号恰好一条。',
].join('\n')
