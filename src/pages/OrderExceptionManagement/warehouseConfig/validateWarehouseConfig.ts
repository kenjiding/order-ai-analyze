import type { WarehouseConfigDto, WarehouseProfileDto } from './types'

export type WarehouseConfigValidationIssue = {
  field: string
  message: string
}

function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
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
  const aliasOwners = new Map<string, string>()

  profiles.forEach((profile, index) => {
    const prefix = `profiles[${index}]`
    if (!profile.hubId.trim()) {
      issues.push({ field: `${prefix}.hubId`, message: 'Hub ID 不能为空' })
    } else if (hubIds.has(profile.hubId.trim())) {
      issues.push({ field: `${prefix}.hubId`, message: `Hub ID 重复: ${profile.hubId}` })
    } else {
      hubIds.add(profile.hubId.trim())
    }

    if (!profile.displayName.trim()) {
      issues.push({ field: `${prefix}.displayName`, message: '显示名不能为空' })
    }

    if (!profile.aliases.length) {
      issues.push({ field: `${prefix}.aliases`, message: '至少需要一个别名' })
    }

    for (const alias of profile.aliases) {
      const key = normalizeAlias(alias)
      if (!key) continue
      const owner = aliasOwners.get(key)
      if (owner && owner !== profile.hubId) {
        issues.push({
          field: `${prefix}.aliases`,
          message: `别名「${alias}」已被 ${owner} 使用`,
        })
      } else {
        aliasOwners.set(key, profile.hubId)
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

export function findWarehouseProfileByAlias(
  config: WarehouseConfigDto,
  raw: string
): WarehouseProfileDto | null {
  const normalized = normalizeAlias(raw)
  if (!normalized) return null
  return (
    config.profiles.find((profile) =>
      profile.aliases.some((alias) => {
        const normalizedAlias = normalizeAlias(alias)
        return normalized === normalizedAlias || normalized.includes(normalizedAlias)
      })
    ) ?? null
  )
}
