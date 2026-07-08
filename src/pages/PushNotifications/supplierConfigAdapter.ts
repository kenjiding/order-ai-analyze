import type { SupplierPushConfig } from '../../shared/supplierPushConfig'
import type { VendorPushConfig } from '../VendorAnalysis/vendorAnalysisTypes'

export function fleetConfigToVendorPushConfig(row: SupplierPushConfig): VendorPushConfig {
  return {
    id: row.id,
    vendorCode: row.vendorCode,
    vendorName: row.vendorName,
    supplierNickname: row.supplierNickname,
    webhookUrl: row.webhookUrl,
    signingSecret: row.signingSecret ?? null,
    pushDescription: row.pushDescription,
    createdBy: null,
    createdAt: '',
    updatedAt: '',
  }
}

export function fleetConfigsToVendorPushConfigs(rows: SupplierPushConfig[]): VendorPushConfig[] {
  return rows.map(fleetConfigToVendorPushConfig)
}
