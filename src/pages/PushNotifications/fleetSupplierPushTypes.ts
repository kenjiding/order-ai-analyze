import type { FleetSupplierConfigDraft } from '../../shared/supplierPushConfig'

export type {
  SupplierPushConfig as FleetSupplierConfig,
  SupplierPushConfigDraft as FleetSupplierConfigDraft,
} from '../../shared/supplierPushConfig'

export { supplierDisplayName, LEGACY_GLOBAL_SUPPLIER_REGION_CODE } from '../../shared/supplierPushConfig'

/** 从表格/JSON 文件解析出的一条待导入供应商：regionCode 由服务端在导入时按当前账号所属州决定，不从文件读取 */
export type FleetSupplierImportRow = FleetSupplierConfigDraft & { id: string }

export type {
  FleetScanRow,
  FleetCityBucket,
  FleetPostcodeBucket,
  FleetRouteBucket,
} from './fleetDomainTypes'
