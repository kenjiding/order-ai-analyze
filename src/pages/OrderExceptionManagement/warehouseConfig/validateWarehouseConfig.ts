import { i18n } from '../../../i18n'
import type { WarehouseConfigDto, WarehouseProfileDto } from './types'

export type WarehouseConfigValidationIssue = {
  field: string
  message: string
}

function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'orderException', ...options })
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
    issues.push({ field: 'global.defaultLossTimeoutDays', message: t('validation.defaultTimeoutMin') })
  }
  if (!Number.isFinite(global.externalCarrierLossTimeoutDays) || global.externalCarrierLossTimeoutDays < 1) {
    issues.push({ field: 'global.externalCarrierLossTimeoutDays', message: t('validation.thirdPartyTimeoutMin') })
  }
  if (!Number.isFinite(global.merchantReturnTimeoutDays) || global.merchantReturnTimeoutDays < 1) {
    issues.push({ field: 'global.merchantReturnTimeoutDays', message: t('validation.merchantReturnTimeoutMin') })
  }

  for (const pattern of global.commonNonRealOperatorPatterns) {
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern)
    } catch {
      issues.push({
        field: 'global.commonNonRealOperatorPatterns',
        message: t('validation.invalidGlobalPattern', { pattern }),
      })
    }
  }

  const hubIds = new Set<string>()
  const trackNameOwners = new Map<string, string>()

  profiles.forEach((profile, index) => {
    const prefix = `profiles[${index}]`
    if (!profile.hubId.trim()) {
      issues.push({ field: `${prefix}.hubId`, message: t('validation.hubIdRequired') })
    } else if (hubIds.has(profile.hubId.trim())) {
      issues.push({
        field: `${prefix}.hubId`,
        message: t('validation.hubIdDuplicate', { hubId: profile.hubId }),
      })
    } else {
      hubIds.add(profile.hubId.trim())
    }

    if (!profile.name.trim()) {
      issues.push({ field: `${prefix}.name`, message: t('validation.hubNameRequired') })
    }

    for (const trackName of profileTrackNames(profile)) {
      const key = normalizeTrackName(trackName)
      if (!key) continue
      const owner = trackNameOwners.get(key)
      if (owner && owner !== profile.hubId) {
        issues.push({
          field: `${prefix}.name`,
          message: t('validation.trackNameTaken', { name: trackName, owner }),
        })
      } else {
        trackNameOwners.set(key, profile.hubId)
      }
    }

    if (profile.lossTimeoutDays !== undefined) {
      if (!Number.isFinite(profile.lossTimeoutDays) || profile.lossTimeoutDays < 1) {
        issues.push({ field: `${prefix}.lossTimeoutDays`, message: t('validation.hubTimeoutMin') })
      }
    }

    for (const pattern of profile.nonRealOperatorPatterns ?? []) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern)
      } catch {
        issues.push({
          field: `${prefix}.nonRealOperatorPatterns`,
          message: t('validation.invalidPattern', { pattern }),
        })
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
