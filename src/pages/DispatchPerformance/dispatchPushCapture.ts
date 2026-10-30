/** 截图定位用的 DOM id：与 supplierKey 一一对应，避免同 vendorCode 不同供应商互相覆盖 */
export function pushSectionId(supplierKey: string): string {
  return `dispatch-push-section-${supplierKey}`
}

/** 合并排名推送模式下，全部供应商共用这一张截图区域——固定 id，不会跟上面按 supplierKey 生成的 id 撞 */
export const PUSH_MERGED_RANKING_SECTION_ID = 'dispatch-push-merged-ranking'
