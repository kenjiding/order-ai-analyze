/** 退返商家可选商家码：前端下拉与后端校验共用同一份定义，避免两边各写一份对不上 */
export type ReturnMerchant = {
  label: string
  clientCode: string
}

export const RETURN_MERCHANTS: ReturnMerchant[] = [
  { label: 'Temu', clientCode: 'C2104008201' },
  { label: 'Shein', clientCode: 'C2103904001' },
  { label: '菜鸟', clientCode: 'C2103914001' },
]

export function isReturnMerchantCode(clientCode: string): boolean {
  return RETURN_MERCHANTS.some((m) => m.clientCode === clientCode)
}

export function returnMerchantLabel(clientCode: string): string {
  return RETURN_MERCHANTS.find((m) => m.clientCode === clientCode)?.label ?? clientCode
}
