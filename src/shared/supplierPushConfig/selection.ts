import type { Key } from 'react'

/** catalog 中可用于飞书推送的配置（已配置 Webhook） */
export function isSupplierPushEligible(config: { webhookUrl: string }): boolean {
  return config.webhookUrl.trim().length > 0
}

export function pruneSelectedConfigIds(allIds: Iterable<string>, selected: string[]): string[] {
  const idSet = new Set(allIds)
  return selected.filter((id) => idSet.has(id))
}

export function selectedPushableConfigs<T extends { id: string; webhookUrl: string }>(
  configs: T[],
  selectedIds: string[],
): T[] {
  const idSet = new Set(selectedIds)
  return configs.filter((c) => idSet.has(c.id) && isSupplierPushEligible(c))
}

export function effectiveSelectedKeys(allIds: Iterable<string>, selected: Key[]): Key[] {
  const idSet = new Set(allIds)
  return selected.filter((id) => idSet.has(String(id)))
}

export function toggleScopeEnabledId(
  enabledIds: string[],
  configId: string,
  enabled: boolean,
): string[] {
  if (enabled) {
    return enabledIds.includes(configId) ? enabledIds : [...enabledIds, configId]
  }
  return enabledIds.filter((id) => id !== configId)
}
