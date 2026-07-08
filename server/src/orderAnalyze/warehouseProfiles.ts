import type { OperatorClassification, WarehouseProfile } from './types'
import {
  DEFAULT_WAREHOUSE_CONFIG,
  createWarehouseProfileContext,
  defaultWarehouseProfileContext,
  parseWarehouseConfigInput,
  type WarehouseConfigDto,
  type WarehouseProfileContext,
} from './warehouseConfig'

export type {
  WarehouseConfigDto,
  WarehouseConfigGlobalDto,
  WarehouseProfileDto,
  WarehouseProfileContext,
} from './warehouseConfig'

export {
  DEFAULT_WAREHOUSE_CONFIG,
  createWarehouseProfileContext,
  defaultWarehouseProfileContext,
  parseWarehouseConfigInput,
} from './warehouseConfig'

export const DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS = DEFAULT_WAREHOUSE_CONFIG.global.defaultLossTimeoutDays

/** 外部承运（3PL）交接后多久仍未完结即判「3PL丢件」；默认与公司仓库库内/库外丢失超时阈值一致 */
export const EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS = DEFAULT_WAREHOUSE_CONFIG.global.externalCarrierLossTimeoutDays

let activeWarehouseProfileContext: WarehouseProfileContext = defaultWarehouseProfileContext

export function resolveWarehouseProfileContext(
  config?: WarehouseConfigDto | null
): WarehouseProfileContext {
  if (!config) return defaultWarehouseProfileContext
  return createWarehouseProfileContext(config)
}

export function runWithWarehouseProfileContext<T>(
  config: WarehouseConfigDto | null | undefined,
  fn: () => T
): T {
  const prev = activeWarehouseProfileContext
  const parsed = config ? parseWarehouseConfigInput(config) : null
  activeWarehouseProfileContext = resolveWarehouseProfileContext(parsed)
  try {
    return fn()
  } finally {
    activeWarehouseProfileContext = prev
  }
}

export async function runWithWarehouseProfileContextAsync<T>(
  config: WarehouseConfigDto | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const prev = activeWarehouseProfileContext
  const parsed = config ? parseWarehouseConfigInput(config) : null
  activeWarehouseProfileContext = resolveWarehouseProfileContext(parsed)
  try {
    return await fn()
  } finally {
    activeWarehouseProfileContext = prev
  }
}

export const WAREHOUSE_PROFILES: readonly WarehouseProfile[] = defaultWarehouseProfileContext.profiles

export function findWarehouseProfileByName(raw: string): WarehouseProfile | null {
  return activeWarehouseProfileContext.findWarehouseProfileByName(raw)
}

export function classifyOperatorForWarehouse(
  operatorName: string,
  profile: WarehouseProfile | null
): OperatorClassification {
  return activeWarehouseProfileContext.classifyOperatorForWarehouse(operatorName, profile)
}

export function getWarehouseLossTimeoutDays(profile: WarehouseProfile | null): number {
  return activeWarehouseProfileContext.getWarehouseLossTimeoutDays(profile)
}

export function getConfiguredSystemOperatorNames(): string[] {
  return activeWarehouseProfileContext.getConfiguredSystemOperatorNames()
}

export function getConfiguredNonRealOperatorNames(): string[] {
  return activeWarehouseProfileContext.getConfiguredNonRealOperatorNames()
}

export function isConfiguredNonRealOrSystemOperator(name: string): boolean {
  return activeWarehouseProfileContext.isConfiguredNonRealOrSystemOperator(name)
}
