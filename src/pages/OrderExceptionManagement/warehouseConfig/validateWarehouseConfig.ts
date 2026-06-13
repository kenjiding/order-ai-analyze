import type { WarehouseConfigDto, WarehouseProfileDto } from './types'

export type WarehouseConfigValidationIssue = {
  field: string
  message: string
}

function normalizeTrackName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

function profileTrackNames(profile: WarehouseProfileDto): string[] {
  return [profile.name, ...(profile.extraAliases ?? [])]
}

export function validateWarehouseConfig(config: WarehouseConfigDto): WarehouseConfigValidationIssue[] {
  const issues: WarehouseConfigValidationIssue[] = []
  const { global, profiles } = config

  if (!Number.isFinite(global.defaultLossTimeoutDays) || global.defaultLossTimeoutDays < 1) {
    issues.push({ field: 'global.defaultLossTimeoutDays', message: '默认丢失超时须 ≥ 1 天' })
  }
  if (!Number.isFinite(global.externalCarrierLossTimeoutDays) || global.externalCarrierLossTimeoutDays < 1) {
    issues.push({ field: 'global.externalCarrierLossTimeoutDays', message: '3PL 超时须 ≥ 1 天' })
  }

  for (const pattern of global.commonNonRealOperatorPatterns) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern)
    } catch {
      issues.push({ field: 'global.commonNonRealOperatorPatterns', message: `无效全局正则: ${pattern}` })
    }
  }

  const hubIds = new Set<string>()
  const trackNameOwners = new Map<string, string>()

  profiles.forEach((profile, index) => {
    const prefix = `profiles[${index}]`
    if (!profile.hubId.trim()) {
      issues.push({ field: `${prefix}.hubId`, message: 'Hub ID 不能为空' })
    } else if (hubIds.has(profile.hubId.trim())) {
      issues.push({ field: `${prefix}.hubId`, message: `Hub ID 重复: ${profile.hubId}` })
    } else {
      hubIds.add(profile.hubId.trim())
    }

    if (!profile.name.trim()) {
      issues.push({ field: `${prefix}.name`, message: '仓库名不能为空' })
    }

    for (const trackName of profileTrackNames(profile)) {
      const key = normalizeTrackName(trackName)
      if (!key) continue
      const owner = trackNameOwners.get(key)
      if (owner && owner !== profile.hubId) {
        issues.push({
          field: `${prefix}.name`,
          message: `轨迹名「${trackName}」已被 ${owner} 使用`,
        })
      } else {
        trackNameOwners.set(key, profile.hubId)
      }
    }

    if (profile.lossTimeoutDays !== undefined) {
      if (!Number.isFinite(profile.lossTimeoutDays) || profile.lossTimeoutDays < 1) {
        issues.push({ field: `${prefix}.lossTimeoutDays`, message: '仓库丢失超时须 ≥ 1 或留空' })
      }
    }

    for (const pattern of profile.nonRealOperatorPatterns ?? []) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern)
      } catch {
        issues.push({ field: `${prefix}.nonRealOperatorPatterns`, message: `无效正则: ${pattern}` })
      }
    }
  })

  return issues
}

export function findWarehouseProfileByTrackName(
  config: WarehouseConfigDto,
  raw: string
): WarehouseProfileDto | null {
  const normalized = normalizeTrackName(raw)
  if (!normalized) return null
  return (
    config.profiles.find((profile) =>
      profileTrackNames(profile).some((trackName) => {
        const normalizedTrackName = normalizeTrackName(trackName)
        return normalized === normalizedTrackName || normalized.includes(normalizedTrackName)
      })
    ) ?? null
  )
}
