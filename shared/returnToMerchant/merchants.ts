import { SHEIN_CLIENT_CODE, TEMU_CLIENT_CODES } from '../clientCode/platformClientCodes'

/** 退返商家移动端扫描页的商家下拉选项（「退返商家完结」页的商家码来自 iMile 集包，不走这份名单） */
export type ReturnMerchant = {
  label: string
  clientCode: string
}

export const RETURN_MERCHANTS: ReturnMerchant[] = [
  { label: 'Temu', clientCode: TEMU_CLIENT_CODES[0] },
  { label: 'Shein', clientCode: SHEIN_CLIENT_CODE },
  { label: '菜鸟', clientCode: 'C2103914001' },
]

export function returnMerchantLabel(clientCode: string): string {
  return RETURN_MERCHANTS.find((m) => m.clientCode === clientCode)?.label ?? clientCode
}
