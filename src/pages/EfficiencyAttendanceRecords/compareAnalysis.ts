import type { EfficiencyAttendanceDayRecord } from '../ScannerEfficiency/dailyEfficiencyRecordSnapshot'

/** 与 aggregates.ts 保持一致：菜鸟件难度折扣 = 1 - 0.75 */
const CAINIAO_DIFFICULTY_DISCOUNT = 0.25

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

export type RootCauseFactor = 'volume' | 'hoursPerPerson' | 'cainiaoShare' | 'personalEfficiency' | 'frontDeskRatio'

export type RootCause = {
  factor: RootCauseFactor
  label: string
  contributionPct: number
  detail: string
  isSignificant: boolean
}

export type CompareAnalysisResult = {
  bestDate: string
  worstDate: string
  efficiencyGapPct: number
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

  // 五因素变异系数（新增前台工时比）
  const volumes = rawMetrics.map((d) => d.volume)
  const hoursPerPersons = rawMetrics.map((d) => d.hoursPerSorter)
  const cainiaoImpacts = rawMetrics.map((d) => d.cainiaoShare * CAINIAO_DIFFICULTY_DISCOUNT)
  const frontDeskRatios = rawMetrics.map((d) => d.frontDeskSharePct)
  const scannerEfficiencies = rawMetrics.map((d) => d.scannerEfficiency).filter((v): v is number => v != null)

  const cvVolume = cv(volumes)
  const cvHours = cv(hoursPerPersons)
  const cvCainiao = cv(cainiaoImpacts)
  const cvFrontDesk = cv(frontDeskRatios)
  const cvScanner = scannerEfficiencies.length >= 2 ? cv(scannerEfficiencies) : 0

  const total = cvVolume + cvHours + cvCainiao + cvFrontDesk + cvScanner || 1
  const pctVolume = (cvVolume / total) * 100
  const pctHours = (cvHours / total) * 100
  const pctCainiao = (cvCainiao / total) * 100
  const pctFrontDesk = (cvFrontDesk / total) * 100
  const pctScanner = (cvScanner / total) * 100

  // Detail strings
  const maxVol = Math.max(...volumes)
  const minVol = Math.min(...volumes)
  const maxHpp = Math.max(...hoursPerPersons)
  const minHpp = Math.min(...hoursPerPersons)
  const maxCainiao = Math.max(...rawMetrics.map((d) => d.cainiaoShare))
  const minCainiao = Math.min(...rawMetrics.map((d) => d.cainiaoShare))
  const maxFrontDesk = Math.max(...frontDeskRatios)
  const minFrontDesk = Math.min(...frontDeskRatios)

  const detailVolume =
    minVol > 0
      ? `最高日 ${maxVol} 票，最低日 ${minVol} 票（差 ${fmt1(((maxVol - minVol) / minVol) * 100)}%）`
      : `最高日 ${maxVol} 票，最低日 ${minVol} 票`

  const detailHours =
    minHpp > 0
      ? `人均工时最高 ${fmt2(maxHpp)}h，最低 ${fmt2(minHpp)}h（差 ${fmt1(((maxHpp - minHpp) / minHpp) * 100)}%）`
      : `人均工时 ${fmt2(maxHpp)}h vs ${fmt2(minHpp)}h`

  const detailCainiao =
    `菜鸟占比最高 ${fmt1(maxCainiao * 100)}%，最低 ${fmt1(minCainiao * 100)}%` +
    (maxCainiao - minCainiao > 0.05 ? '，日间波动较大' : '')

  const detailFrontDesk = `前台工时占比最高 ${fmt1(maxFrontDesk * 100)}%，最低 ${fmt1(minFrontDesk * 100)}%（前台不产出扫描量，占比越高总效率越低）`

  const detailScanner =
    scannerEfficiencies.length >= 2
      ? `整体效率最高日 ${fmt2(Math.max(...scannerEfficiencies))} 票/h，最低日 ${fmt2(Math.min(...scannerEfficiencies))} 票/h`
      : '（部分日期无扫描员数据）'

  const rootCauses: RootCause[] = [
    {
      factor: 'volume',
      label: '货量规模',
      contributionPct: pctVolume,
      detail: detailVolume,
      isSignificant: pctVolume >= 5,
    },
    {
      factor: 'frontDeskRatio',
      label: '前台工时占比',
      contributionPct: pctFrontDesk,
      detail: detailFrontDesk,
      isSignificant: pctFrontDesk >= 5,
    },
    {
      factor: 'hoursPerPerson',
      label: '人均工时',
      contributionPct: pctHours,
      detail: detailHours,
      isSignificant: pctHours >= 5,
    },
    {
      factor: 'personalEfficiency',
      label: '分拣员个人效率',
      contributionPct: pctScanner,
      detail: detailScanner,
      isSignificant: pctScanner >= 5,
    },
    {
      factor: 'cainiaoShare',
      label: '菜鸟件难度',
      contributionPct: pctCainiao,
      detail: detailCainiao,
      isSignificant: pctCainiao >= 5,
    },
  ].sort((a, b) => b.contributionPct - a.contributionPct)

  // 改善建议（规则驱动，带量化）
  const suggestions: string[] = []
  const worstM = dayMetrics.find((d) => d.date === worstDate)!
  const bestM = dayMetrics.find((d) => d.date === bestDate)!
  const topCause = rootCauses[0]!

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
    (suggestions.length === 0 && pctFrontDesk >= 5)
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
    (suggestions.length === 0 && pctHours >= 5)
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

  if (maxCainiao - minCainiao > 0.06 && pctCainiao >= 5) {
    suggestions.push(
      `菜鸟件占比波动 ${fmt1((maxCainiao - minCainiao) * 100)}%，菜鸟日分拣难度更高，建议对比时优先参考菜鸟修正效率，或在菜鸟占比高的日子安排更有经验的分拣员。`,
    )
  }

  if (scannerEfficiencies.length >= 2 && pctScanner >= 5) {
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
