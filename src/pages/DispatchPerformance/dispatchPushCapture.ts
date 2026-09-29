/** 截图定位用的 DOM id：与 supplierKey 一一对应，避免同 vendorCode 不同供应商互相覆盖 */
export function pushSectionId(supplierKey: string): string {
  return `dispatch-push-section-${supplierKey}`
}
