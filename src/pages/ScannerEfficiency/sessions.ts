import type { ScanSettings } from './constants'

type SessionAcc = {
  scanCount: number
  effectiveMinutes: number
  firstScan: Date
  lastScan: Date
  cappedGapCount: number
}

export type ScanRecord = {
  scanTime: Date
}

const toMinutes = (milliseconds: number): number => milliseconds / 1000 / 60

const finalizeSession = (session: SessionAcc | null, settings: ScanSettings): SessionAcc | null => {
  if (!session) return null

  /** 数据源常出现「同一时间戳多条扫描」导出，间隔之和接近 0 或仅有秒级抖动；单笔扫描原本就用最小会话时长兜底，多笔也必须一致，否则会「工时≈0、效率失真」。 */
  const effectiveMinutes = Math.max(
    session.effectiveMinutes,
    settings.minSingleScanSessionMinutes,
  )

  return {
    ...session,
    effectiveMinutes,
    firstScan: session.firstScan,
    lastScan: session.lastScan,
  }
}

export const computeSessions = <T extends ScanRecord>(records: T[], settings: ScanSettings): SessionAcc[] => {
  const sorted = [...records].sort((a, b) => a.scanTime.getTime() - b.scanTime.getTime())
  if (!sorted.length) return []

  const sessions: SessionAcc[] = []
  let currentSession: SessionAcc = {
    scanCount: 1,
    effectiveMinutes: 0,
    firstScan: sorted[0].scanTime,
    lastScan: sorted[0].scanTime,
    cappedGapCount: 0,
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]
    const current = sorted[i]
    const gapMinutes = toMinutes(current.scanTime.getTime() - previous.scanTime.getTime())

    if (gapMinutes > settings.splitThresholdMinutes) {
      const finalized = finalizeSession(currentSession, settings)
      if (finalized) sessions.push(finalized)
      currentSession = {
        scanCount: 1,
        effectiveMinutes: 0,
        firstScan: current.scanTime,
        lastScan: current.scanTime,
        cappedGapCount: 0,
      }
      continue
    }

    currentSession.scanCount += 1
    currentSession.lastScan = current.scanTime
    currentSession.effectiveMinutes += Math.min(gapMinutes, settings.breakCapMinutes)
    if (gapMinutes > settings.breakCapMinutes) {
      currentSession.cappedGapCount += 1
    }
  }

  const last = finalizeSession(currentSession, settings)
  if (last) sessions.push(last)
  return sessions
}
