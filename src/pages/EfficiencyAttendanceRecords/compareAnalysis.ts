import { i18n } from '../../i18n'
import {
  resolveEfficiencyAttendanceDayKind,
  type EfficiencyAttendanceDayRecord,
} from '../ScannerEfficiency/dailyEfficiencyRecordSnapshot'

const NS = 'efficiencyRecords'

function tr(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: NS, ...opts }))
}

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

function fmt1(n: number): string {
  return n.toFixed(1)
}

function fmt2(n: number): string {
  return n.toFixed(2)
}

/** 只有「到件+考勤」齐全的日子才有当日效率，无到件补录日与缺考勤日不能进最优/最差日对比 */
export function selectComparableRecords(
  records: EfficiencyAttendanceDayRecord[],
): EfficiencyAttendanceDayRecord[] {
  return records.filter(
    (record) => resolveEfficiencyAttendanceDayKind(record.warehouse.daily) === 'full',
  )
}

export function computeCompareAnalysis(records: EfficiencyAttendanceDayRecord[]): CompareAnalysisResult {
  const comparableRecords = selectComparableRecords(records)
  if (comparableRecords.length < 2) {
    throw new Error(tr('analysis.errors.insufficientComparableDays'))
  }

  const rawMetrics = comparableRecords.map((record) => {
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

    const dayEfficiency = daily.dayEfficiency ?? null
    const openEfficiency =
      daily.isOpenDay && daily.totalHours > 0 ? daily.volume / daily.totalHours : dayEfficiency
    const overallEfficiency = daily.totalHours > 0 ? daily.volume / daily.totalHours : dayEfficiency

    return {
      date: record.date,
      dayEfficiency,
      openEfficiency,
      overallEfficiency,
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

  const detailCainiao = worstM_raw.cainiaoShare > bestM_raw.cainiaoShare
    ? tr('analysis.detail.cainiaoHigherOnWorst', {
        worstPct: fmt1(worstM_raw.cainiaoShare * 100),
        bestPct: fmt1(bestM_raw.cainiaoShare * 100),
        worstBonus: fmt1(cainiaoBonus_W),
        bestBonus: fmt1(cainiaoBonus_B),
      })
    : worstM_raw.cainiaoShare < bestM_raw.cainiaoShare
      ? tr('analysis.detail.cainiaoLowerOnWorst', {
          worstPct: fmt1(worstM_raw.cainiaoShare * 100),
          bestPct: fmt1(bestM_raw.cainiaoShare * 100),
        })
      : tr('analysis.detail.cainiaoSimilar', { pct: fmt1(worstM_raw.cainiaoShare * 100) })

  const detailFrontDesk = tr('analysis.detail.frontDesk', {
    worstPct: fmt1(worstM_raw.frontDeskSharePct * 100),
    bestPct: fmt1(bestM_raw.frontDeskSharePct * 100),
  })

  const detailVolume = bestM_raw.volume > 0
    ? tr('analysis.detail.volumeWithBest', {
        bestVolume: bestM_raw.volume,
        worstVolume: worstM_raw.volume,
        diffPct: fmt1(Math.abs((bestM_raw.volume - worstM_raw.volume) / bestM_raw.volume) * 100),
      })
    : tr('analysis.detail.volumeSimple', {
        bestVolume: bestM_raw.volume,
        worstVolume: worstM_raw.volume,
      })

  const detailHpp = bestM_raw.hoursPerSorter > 0
    ? tr('analysis.detail.hoursPerPerson', {
        bestHpp: fmt2(bestM_raw.hoursPerSorter),
        worstHpp: fmt2(worstM_raw.hoursPerSorter),
      })
    : tr('analysis.detail.hoursPerPersonIncomplete')

  const detailScanner = bestM_raw.scannerEfficiency != null && worstM_raw.scannerEfficiency != null
    ? tr('analysis.detail.scanner', {
        bestEff: fmt2(bestM_raw.scannerEfficiency),
        worstEff: fmt2(worstM_raw.scannerEfficiency),
      })
    : tr('analysis.detail.scannerMissing')

  const normalizedGap = pureEff_B - pureEff_W
  const detailResidual = tr('analysis.detail.residual', {
    residualAbs: fmt1(Math.abs(residualContrib)),
    pureBest: fmt1(pureEff_B),
    pureWorst: fmt1(pureEff_W),
    normalizedGap: fmt1(normalizedGap),
  })

  const rootCauses: RootCause[] = [
    makeRootCause('cainiaoShare', tr('analysis.rootCause.cainiaoShare'), cainiaoContrib, detailCainiao),
    makeRootCause('frontDeskRatio', tr('analysis.rootCause.frontDeskRatio'), frontDeskContrib, detailFrontDesk),
    makeRootCause('volume', tr('analysis.rootCause.volume'), volumeContrib, detailVolume),
    makeRootCause('hoursPerPerson', tr('analysis.rootCause.hoursPerPerson'), hppContrib, detailHpp),
    makeRootCause('personalEfficiency', tr('analysis.rootCause.personalEfficiency'), scannerContrib, detailScanner),
    makeRootCause('residual', tr('analysis.rootCause.residual'), residualContrib, detailResidual),
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
          tr('analysis.suggestion.volumeReduceStaff', {
            worstVolume: worstM.volume,
            bestVolume: bestM.volume,
            reducible,
          }),
        )
      } else {
        suggestions.push(
          tr('analysis.suggestion.volumeInsufficient', {
            worstVolume: worstM.volume,
            diffPct: fmt1(((bestM.volume - worstM.volume) / bestM.volume) * 100),
          }),
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
        tr('analysis.suggestion.frontDesk', {
          worstPct: fmt1(worstFD * 100),
          worstHours: fmt2(worstFDHours),
          bestPct: fmt1(bestFD * 100),
        }),
      )
    }
  }

  if (
    (topCause.factor === 'hoursPerPerson' && topCause.isSignificant) ||
    (suggestions.length === 0 && (hoursRC?.isSignificant ?? false))
  ) {
    if (worstM.hoursPerSorter > bestM.hoursPerSorter && worstM.hoursPerSorter > 0) {
      suggestions.push(
        tr('analysis.suggestion.hoursPerPersonLonger', {
          worstHpp: fmt2(worstM.hoursPerSorter),
          bestHpp: fmt2(bestM.hoursPerSorter),
        }),
      )
    } else if (bestM.hoursPerSorter > worstM.hoursPerSorter) {
      suggestions.push(
        tr('analysis.suggestion.hoursPerPersonShorter', {
          worstHpp: fmt2(worstM.hoursPerSorter),
          bestHpp: fmt2(bestM.hoursPerSorter),
        }),
      )
    }
  }

  if (maxCainiao - minCainiao > 0.06 && (cainiaoRC?.isSignificant ?? false)) {
    const worstCainiao = worstM.cainiaoShare
    const bestCainiao = bestM.cainiaoShare
    if (worstCainiao < bestCainiao - 0.03) {
      suggestions.push(
        tr('analysis.suggestion.cainiaoLower', {
          worstPct: fmt1(worstCainiao * 100),
          bestPct: fmt1(bestCainiao * 100),
        }),
      )
    } else if (worstCainiao > bestCainiao + 0.03) {
      suggestions.push(
        tr('analysis.suggestion.cainiaoHigher', {
          worstPct: fmt1(worstCainiao * 100),
          bestPct: fmt1(bestCainiao * 100),
        }),
      )
    } else {
      suggestions.push(
        tr('analysis.suggestion.cainiaoStable', {
          spreadPct: fmt1((maxCainiao - minCainiao) * 100),
        }),
      )
    }
  }

  if (scannerEfficiencies.length >= 2 && (scannerRC?.isSignificant ?? false)) {
    const maxE = Math.max(...scannerEfficiencies)
    const minE = Math.min(...scannerEfficiencies)
    suggestions.push(
      tr('analysis.suggestion.scannerGap', { gap: fmt2(maxE - minE) }),
    )
  }

  if (!suggestions.length) {
    suggestions.push(tr('analysis.suggestion.default'))
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
      role: p.isFrontDesk
        ? tr('analysis.roles.frontDesk')
        : p.isSorterWorker
          ? tr('analysis.roles.sorter')
          : p.positionTitle || tr('analysis.roles.other'),
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
