/** 退返商家移动端扫描页的商家下拉选项（「退返商家完结」页的商家码来自 iMile 集包，不走这份名单） */
export type ReturnMerchant = {
  label: string
  clientCode: string
}

export const RETURN_MERCHANTS: ReturnMerchant[] = [
  { label: 'Temu', clientCode: 'C2104008201' },
  { label: 'Shein', clientCode: 'C2103904001' },
  { label: '菜鸟', clientCode: 'C2103914001' },
]

export function returnMerchantLabel(clientCode: string): string {
  return RETURN_MERCHANTS.find((m) => m.clientCode === clientCode)?.label ?? clientCode
}
