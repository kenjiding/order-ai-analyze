import type { EfficiencyAttendanceDayRecord } from '../ScannerEfficiency/dailyEfficiencyRecordSnapshot'

/** 与 aggregates.ts 一致：菜鸟件仅需普通件约 75% 时间，占比越高当日效率天然偏高 */
const CAINIAO_EASE_DISCOUNT = 0.25

export type PersonnelRow = {
  sorterName: string
  hours: number
  isFrontDesk: boolean
  isSorterWorker: boolean
  positionTitle: string
}

export type ScannerRow = {
  scanner: string
  scanCount: number
  efficiency: number
  adjustedEfficiency: number
  cainiaoAdjustedEfficiency: number
  cainiaoShare: number
  cainiaoCorrectionFactor: number
  effectiveHours: number
  reliabilityWeight: number
}

export type DayMetrics = {
  date: string
  dayEfficiency: number | null
  openEfficiency: number | null
  overallEfficiency: number | null
  volume: number
  totalHours: number
  sorterCount: number
  hoursPerSorter: number
  sorterHours: number
  frontDeskHours: number
  otherHours: number
  frontDeskSharePct: number
  cainiaoShare: number
  scannerEfficiency: number | null
  laborCost: number | null
  personnel: PersonnelRow[]
  scanners: ScannerRow[]
  isBest: boolean
  isWorst: boolean
}

export type RootCauseFactor = 'volume' | 'hoursPerPerson' | 'cainiaoShare' | 'personalEfficiency' | 'frontDeskRatio' | 'residual'

export type RootCause = {
  factor: RootCauseFactor
  label: string
  /** 贡献量（票/h），正 = 拉大差距（伤害最差日），负 = 弥补差距（帮助最差日） */
  contributionAbs: number
  /** 占总差距的绝对百分比（不带符号，仅用于进度条宽度） */
  contributionPct: number
  /** 方向：hurt = 加剧差距，help = 弥补差距 */
  direction: 'hurts' | 'helps' | 'neutral'
  detail: string
  isSignificant: boolean
}

export type CompareAnalysisResult = {
  bestDate: string
  worstDate: string
  efficiencyGapPct: number
  /** 最优日与最差日的效率差（票/h）= bestEff - worstEff */
  efficiencyGapAbs: number
  /** 最差日去除菜鸟结构后的纯运营效率（票/h） */
  worstNormalizedEff: number
  /** 最优日去除菜鸟结构后的纯运营效率（票/h） */
  bestNormalizedEff: number
  dayMetrics: DayMetrics[]
  rootCauses: RootCause[]
  suggestions: string[]
  hasMissingScanner: boolean
  hasMissingPersonnel: boolean
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function cv(values: number[]): number {
  if (!values.length) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  if (mean === 0) return 0
  return stdDev(values) / mean
}

function fmt1(n: number): string {
  return n.toFixed(1)
}

function fmt2(n: number): string {
  return n.toFixed(2)
}

export function computeCompareAnalysis(records: EfficiencyAttendanceDayRecord[]): CompareAnalysisResult {
  const rawMetrics = records.map((record) => {
    const daily = record.warehouse.daily
    const personDayRows = record.warehouse.personDayRows ?? []
    const sorterCount = daily.sorterCount ?? 0
    const totalHours = daily.totalHours ?? 0
    const hoursPerSorter = sorterCount > 0 ? totalHours / sorterCount : 0

    // 工时结构分解
    let sorterHours = 0
    let frontDeskHours = 0
    let otherHours = 0
    const personnel: PersonnelRow[] = personDayRows.map((p) => {
      if (p.isFrontDesk) {
        frontDeskHours += p.hours
      } else if (p.isSorterWorker) {
        sorterHours += p.hours
      } else {
        otherHours += p.hours
      }
      return {
        sorterName: p.sorterName || p.sorterKey,
        hours: p.hours,
        isFrontDesk: p.isFrontDesk,
        isSorterWorker: p.isSorterWorker,
        positionTitle: p.positionTitle ?? '',
      }
    })

    const frontDeskSharePct = totalHours > 0 ? frontDeskHours / totalHours : 0
    const scannerEfficiency = record.scanner?.summary?.totalEfficiency ?? null
    const scanners: ScannerRow[] = (record.scanner?.scannerTotalRows ?? []).map((r) => ({
      scanner: r.scanner,
      scanCount: r.scanCount,
      efficiency: r.efficiency,
      adjustedEfficiency: r.adjustedEfficiency,
      cainiaoAdjustedEfficiency: r.cainiaoAdjustedEfficiency,
      cainiaoShare: r.cainiaoShare,
      cainiaoCorrectionFactor: r.cainiaoCorrectionFactor,
      effectiveHours: r.effectiveHours,
      reliabilityWeight: r.reliabilityWeight,
    }))

    return {
      date: record.date,
      dayEfficiency: daily.dayEfficiency ?? null,
      openEfficiency: daily.openEfficiency ?? null,
      overallEfficiency: daily.overallEfficiency ?? null,
      volume: daily.volume ?? 0,
      totalHours,
      sorterCount,
      hoursPerSorter,
      sorterHours,
      frontDeskHours,
      otherHours,
      frontDeskSharePct,
      cainiaoShare: daily.cainiaoShare ?? 0,
      scannerEfficiency,
      laborCost: record.payroll?.totalLaborCost ?? null,
      personnel,
      scanners,
    }
  })

  // 最高/最低效率日
  const getPrimaryEff = (d: (typeof rawMetrics)[number]) => d.dayEfficiency ?? d.overallEfficiency ?? 0
  const sorted = [...rawMetrics].sort((a, b) => getPrimaryEff(a) - getPrimaryEff(b))
  const worstDate = sorted[0]!.date
  const bestDate = sorted[sorted.length - 1]!.date

  const bestEff = getPrimaryEff(sorted[sorted.length - 1]!)
  const worstEff = getPrimaryEff(sorted[0]!)
  const efficiencyGapPct = worstEff > 0 ? ((bestEff - worstEff) / worstEff) * 100 : 0

  const dayMetrics: DayMetrics[] = rawMetrics.map((d) => ({
    ...d,
    isBest: d.date === bestDate,
    isWorst: d.date === worstDate,
  }))

  const hasMissingScanner = rawMetrics.some((d) => d.scanners.length === 0)
  const hasMissingPersonnel = rawMetrics.some((d) => d.personnel.length === 0)

  // ── 有向瀑布分解：最优日 vs 最差日 ────────────────────────────────────────────
  // 正确的分析：逐因素计算对差距的有向贡献（正=拉大差距/伤害最差日，负=弥补差距/帮助最差日）
  const bestM_raw = rawMetrics.find((d) => d.date === bestDate)!
  const worstM_raw = rawMetrics.find((d) => d.date === worstDate)!
  const E_B = getPrimaryEff(bestM_raw)
  const E_W = getPrimaryEff(worstM_raw)
  const totalGap = E_B - E_W  // 正数，最优减最差
  const refEff = (E_B + E_W) / 2

  // 1. 菜鸟结构效应
  // 菜鸟件更快，占比越高效率天然偏高。若最差日菜鸟占比反而更高，则菜鸟帮助了最差日（弥补差距）。
  // cainiaoBonus ≈ E × cainiaoShare × CAINIAO_EASE_DISCOUNT（一阶近似）
  const cainiaoBonus_B = E_B * bestM_raw.cainiaoShare * CAINIAO_EASE_DISCOUNT
  const cainiaoBonus_W = E_W * worstM_raw.cainiaoShare * CAINIAO_EASE_DISCOUNT
  // 菜鸟对差距的贡献 = 最优日的菜鸟加成 - 最差日的菜鸟加成
  // 若为负：最差日菜鸟加成更大 → 弥补了差距（帮助最差日）
  const cainiaoContrib = cainiaoBonus_B - cainiaoBonus_W

  // 纯运营效率（剥离菜鸟结构后）
  const pureEff_B = E_B - cainiaoBonus_B
  const pureEff_W = E_W - cainiaoBonus_W

  // 2. 前台工时拖累
  // 前台不产出扫描量，占比越高效率越低。若最差日前台占比更高，则对差距有正向贡献（加剧）。
  const avgFrontDesk = (bestM_raw.frontDeskSharePct + worstM_raw.frontDeskSharePct) / 2
  const frontDeskDivisor = Math.max(1 - avgFrontDesk, 0.3)
  const frontDeskContrib = refEff * (worstM_raw.frontDeskSharePct - bestM_raw.frontDeskSharePct) / frontDeskDivisor

  // 3. 货量规模效应
  // 货量低但人数不变 → 效率低。只计算货量差异带来的直接影响。
  const V_avg = (bestM_raw.volume + worstM_raw.volume) / 2
  const sorterRatioAdj = bestM_raw.sorterCount > 0 && worstM_raw.sorterCount > 0
    ? Math.min(1.2, bestM_raw.sorterCount / worstM_raw.sorterCount)
    : 1
  const volumeContrib = V_avg > 0
    ? refEff * (bestM_raw.volume - worstM_raw.volume) / V_avg * sorterRatioAdj * 0.4
    : 0

  // 4. 人均工时效应
  // 相同货量下工时越长效率越低（人员冗余或低效在岗）
  const hppContrib = bestM_raw.hoursPerSorter > 0 && worstM_raw.hoursPerSorter > 0
    ? refEff * (worstM_raw.hoursPerSorter / bestM_raw.hoursPerSorter - 1) * 0.35
    : 0

  // 5. 分拣员个人效率（来自扫描员数据，最直接的人员效率衡量）
  const scannerEfficiencies = rawMetrics.map((d) => d.scannerEfficiency).filter((v): v is number => v != null)
  const scannerContrib = bestM_raw.scannerEfficiency != null && worstM_raw.scannerEfficiency != null
    ? (bestM_raw.scannerEfficiency - worstM_raw.scannerEfficiency) * 0.3
    : 0

  // 6. 残差（无法用以上结构因素解释的运营差距）
  const explained = cainiaoContrib + frontDeskContrib + volumeContrib + hppContrib + scannerContrib
  const residualContrib = totalGap - explained

  const absTotalForPct = Math.abs(cainiaoContrib) + Math.abs(frontDeskContrib) + Math.abs(volumeContrib) + Math.abs(hppContrib) + Math.abs(scannerContrib) + Math.abs(residualContrib) || 1

  function makeRootCause(
    factor: RootCauseFactor,
    label: string,
    absContrib: number,
    detail: string,
  ): RootCause {
    const direction: RootCause['direction'] = Math.abs(absContrib) < 0.5 ? 'neutral' : absContrib > 0 ? 'hurts' : 'helps'
    return {
      factor,
      label,
      contributionAbs: absContrib,
      contributionPct: (Math.abs(absContrib) / absTotalForPct) * 100,
      direction,
      detail,
      isSignificant: Math.abs(absContrib) >= 1.0 || (totalGap > 0 && Math.abs(absContrib / totalGap) >= 0.05),
    }
  }

  // Detail 描述
  const detailCainiao = worstM_raw.cainiaoShare > bestM_raw.cainiaoShare
    ? `最差日菜鸟占比 ${fmt1(worstM_raw.cainiaoShare * 100)}%，高于最优日 ${fmt1(bestM_raw.cainiaoShare * 100)}%。菜鸟件处理更快，最差日因此获得 ${fmt1(cainiaoBonus_W)} 票/h 结构性加成（最优日仅 ${fmt1(cainiaoBonus_B)} 票/h），弥补了部分差距，但掩盖了更大的运营问题。`
    : worstM_raw.cainiaoShare < bestM_raw.cainiaoShare
    ? `最差日菜鸟占比 ${fmt1(worstM_raw.cainiaoShare * 100)}%，低于最优日 ${fmt1(bestM_raw.cainiaoShare * 100)}%。菜鸟占比低导致效率天然偏低，加剧了差距。`
    : `两日菜鸟占比相近（${fmt1(worstM_raw.cainiaoShare * 100)}%），菜鸟结构对差距贡献有限。`

  const detailFrontDesk = `最差日前台工时占比 ${fmt1(worstM_raw.frontDeskSharePct * 100)}%，最优日 ${fmt1(bestM_raw.frontDeskSharePct * 100)}%（前台不产出扫描量，占比越高总效率越低）`

  const detailVolume = bestM_raw.volume > 0
    ? `最优日货量 ${bestM_raw.volume} 票，最差日 ${worstM_raw.volume} 票（差 ${fmt1(Math.abs((bestM_raw.volume - worstM_raw.volume) / bestM_raw.volume) * 100)}%）。货量不足时人员固定成本被摊薄，效率自然下降。`
    : `货量对比：最优日 ${bestM_raw.volume} 票，最差日 ${worstM_raw.volume} 票`

  const detailHpp = bestM_raw.hoursPerSorter > 0
    ? `最优日人均工时 ${fmt2(bestM_raw.hoursPerSorter)}h，最差日 ${fmt2(worstM_raw.hoursPerSorter)}h（工时越长但产出未增加，说明低货量下人员在仓时间过长）`
    : '人均工时数据不完整'

  const detailScanner = bestM_raw.scannerEfficiency != null && worstM_raw.scannerEfficiency != null
    ? `最优日分拣员综合效率 ${fmt2(bestM_raw.scannerEfficiency)} 票/h，最差日 ${fmt2(worstM_raw.scannerEfficiency)} 票/h（菜鸟结构修正后的个人效率对比）`
    : '部分日期无分拣员扫描数据，无法计算个人效率贡献'

  const normalizedGap = pureEff_B - pureEff_W
  const detailResidual = `去除以上可量化结构因素后，最差日仍有约 ${fmt1(Math.abs(residualContrib))} 票/h 的效率差距无法解释，可能源于人员状态、设备故障、流程混乱等即时运营因素。纯运营效率差（剥离菜鸟结构）：${fmt1(pureEff_B)} vs ${fmt1(pureEff_W)} = ${fmt1(normalizedGap)} 票/h。`

  const rootCauses: RootCause[] = [
    makeRootCause('cainiaoShare', '菜鸟结构效应', cainiaoContrib, detailCainiao),
    makeRootCause('frontDeskRatio', '前台工时拖累', frontDeskContrib, detailFrontDesk),
    makeRootCause('volume', '货量规模差异', volumeContrib, detailVolume),
    makeRootCause('hoursPerPerson', '人均工时冗余', hppContrib, detailHpp),
    makeRootCause('personalEfficiency', '分拣员个人效率', scannerContrib, detailScanner),
    makeRootCause('residual', '运营残差（未解释）', residualContrib, detailResidual),
  ].sort((a, b) => Math.abs(b.contributionAbs) - Math.abs(a.contributionAbs))

  // 改善建议（规则驱动，带量化）
  const suggestions: string[] = []
  const worstM = dayMetrics.find((d) => d.date === worstDate)!
  const bestM = dayMetrics.find((d) => d.date === bestDate)!
  const topCause = rootCauses[0]!

  // 从新根因结构中取各因素的显著性（替代已删除的 pct* 变量）
  const frontDeskRC = rootCauses.find((c) => c.factor === 'frontDeskRatio')
  const hoursRC = rootCauses.find((c) => c.factor === 'hoursPerPerson')
  const cainiaoRC = rootCauses.find((c) => c.factor === 'cainiaoShare')
  const scannerRC = rootCauses.find((c) => c.factor === 'personalEfficiency')

  const maxCainiao = Math.max(...rawMetrics.map((d) => d.cainiaoShare))
  const minCainiao = Math.min(...rawMetrics.map((d) => d.cainiaoShare))

  if (topCause.factor === 'volume' && topCause.isSignificant) {
    if (bestM.volume > 0) {
      const targetCount = Math.max(1, Math.round((worstM.sorterCount * worstM.volume) / bestM.volume))
      const reducible = worstM.sorterCount - targetCount
      if (reducible > 0) {
        suggestions.push(
          `最差日货量仅 ${worstM.volume} 票（最优日 ${bestM.volume} 票），建议低货量日减少分拣人数约 ${reducible} 人，避免工时虚耗。`,
        )
      } else {
        suggestions.push(
          `最差日货量仅 ${worstM.volume} 票，较最优日少 ${fmt1(((bestM.volume - worstM.volume) / bestM.volume) * 100)}%，货量不足是效率主因，需关注到仓件数波动原因。`,
        )
      }
    }
  }

  if (
    (topCause.factor === 'frontDeskRatio' && topCause.isSignificant) ||
    (suggestions.length === 0 && (frontDeskRC?.isSignificant ?? false))
  ) {
    const worstFD = worstM.frontDeskSharePct
    const bestFD = bestM.frontDeskSharePct
    if (worstFD > bestFD + 0.05) {
      const worstFDHours = worstM.frontDeskHours
      suggestions.push(
        `最差日前台工时占 ${fmt1(worstFD * 100)}%（共 ${fmt2(worstFDHours)}h），明显高于最优日 ${fmt1(bestFD * 100)}%，前台人员占用了大量工时但不产出扫描量，建议低货量日削减前台班次。`,
      )
    }
  }

  if (
    (topCause.factor === 'hoursPerPerson' && topCause.isSignificant) ||
    (suggestions.length === 0 && (hoursRC?.isSignificant ?? false))
  ) {
    if (worstM.hoursPerSorter > bestM.hoursPerSorter && worstM.hoursPerSorter > 0) {
      suggestions.push(
        `最差日人均工时 ${fmt2(worstM.hoursPerSorter)}h，高于最优日 ${fmt2(bestM.hoursPerSorter)}h，低货量日分拣员在仓时间偏长，建议按货量动态调整班次时长。`,
      )
    } else if (bestM.hoursPerSorter > worstM.hoursPerSorter) {
      suggestions.push(
        `最差日人均工时 ${fmt2(worstM.hoursPerSorter)}h，低于最优日 ${fmt2(bestM.hoursPerSorter)}h，建议保证高峰期充足在岗时长，避免人手不足拖慢分拣节奏。`,
      )
    }
  }

  if (maxCainiao - minCainiao > 0.06 && (cainiaoRC?.isSignificant ?? false)) {
    const worstCainiao = worstM.cainiaoShare
    const bestCainiao = bestM.cainiaoShare
    if (worstCainiao < bestCainiao - 0.03) {
      suggestions.push(
        `最差日菜鸟占比 ${fmt1(worstCainiao * 100)}%，低于最优日 ${fmt1(bestCainiao * 100)}%。菜鸟件处理更快，占比偏低会拉低整体效率，部分效率差距可由货量结构解释。`,
      )
    } else if (worstCainiao > bestCainiao + 0.03) {
      suggestions.push(
        `最差日菜鸟占比 ${fmt1(worstCainiao * 100)}% 反而高于最优日 ${fmt1(bestCainiao * 100)}%，说明效率差距主要不由菜鸟结构造成，应重点排查人手排班与前台工时等因素。`,
      )
    } else {
      suggestions.push(
        `各日菜鸟占比波动 ${fmt1((maxCainiao - minCainiao) * 100)}%，日间差异不大；菜鸟占比越高效率天然偏高，对比时宜结合货量结构解读。`,
      )
    }
  }

  if (scannerEfficiencies.length >= 2 && (scannerRC?.isSignificant ?? false)) {
    const maxE = Math.max(...scannerEfficiencies)
    const minE = Math.min(...scannerEfficiencies)
    suggestions.push(
      `不同日期分拣员整体效率差距 ${fmt2(maxE - minE)} 票/h，建议重点关注低效率日的人员排班，针对性提升技能薄弱员工。`,
    )
  }

  if (!suggestions.length) {
    suggestions.push('各日期效率差距较小，四个主要因素分布均匀，建议继续积累更多日期数据以发现规律。')
  }

  return {
    bestDate,
    worstDate,
    efficiencyGapPct,
    efficiencyGapAbs: totalGap,
    worstNormalizedEff: pureEff_W,
    bestNormalizedEff: pureEff_B,
    dayMetrics,
    rootCauses,
    suggestions,
    hasMissingScanner,
    hasMissingPersonnel,
  }
}

/** 构建发送给 AI 的 day snapshot payload */
export function buildDaySnapshots(dayMetrics: DayMetrics[]) {
  return dayMetrics.map((d) => ({
    date: d.date,
    dayEfficiency: d.dayEfficiency,
    volume: d.volume,
    totalHours: d.totalHours,
    sorterCount: d.sorterCount,
    frontDeskHours: d.frontDeskHours,
    sorterHours: d.sorterHours,
    frontDeskSharePct: d.frontDeskSharePct,
    cainiaoShare: d.cainiaoShare,
    laborCost: d.laborCost,
    personnel: d.personnel.map((p) => ({
      name: p.sorterName,
      hours: p.hours,
      role: p.isFrontDesk ? '前台' : p.isSorterWorker ? '分拣员' : p.positionTitle || '其他',
      isFrontDesk: p.isFrontDesk,
    })),
    scanners: d.scanners.slice(0, 20).map((s) => ({
      name: s.scanner,
      scanCount: s.scanCount,
      rawEfficiency: s.efficiency,
      adjustedEfficiency: s.cainiaoAdjustedEfficiency,
      cainiaoShare: s.cainiaoShare,
    })),
  }))
}
