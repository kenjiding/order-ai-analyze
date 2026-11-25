/**
 * Temu / Shein 商家 clientCode 唯一真源。全项目判断“是否 Temu/Shein 包裹”都用这里的
 * isTemuClientCode / isSheinClientCode，不要再各处散落硬编码 clientCode 字符串。
 * 包裹 clientCode 命中 TEMU_CLIENT_CODES 任意一个即视为 Temu 包裹。
 */
export const TEMU_CLIENT_CODES = [
  'C2104008201',
  'C2104002201',
  'C2104005601',
  'C2104228901',
  'C2104228801',
] as const

export const SHEIN_CLIENT_CODE = 'C2103904001'

const TEMU_CLIENT_CODE_SET = new Set<string>(TEMU_CLIENT_CODES)

export function isTemuClientCode(clientCode: string | null | undefined): boolean {
  if (!clientCode) return false
  return TEMU_CLIENT_CODE_SET.has(clientCode.trim().toUpperCase())
}

export function isSheinClientCode(clientCode: string | null | undefined): boolean {
  if (!clientCode) return false
  return clientCode.trim().toUpperCase() === SHEIN_CLIENT_CODE
}

export type ClientCodeBrand = 'temu' | 'shein' | 'local' | 'other'

/** 按 clientCode 分 Temu/Shein/本地件(优先客户)/其他；本地件需传入「优先客户配置」clientCode 集合，不传则本地件归到 other */
export function classifyClientCodeBrand(
  clientCode: string | null | undefined,
  priorityClientCodes?: Set<string>,
): ClientCodeBrand {
  if (isTemuClientCode(clientCode)) return 'temu'
  if (isSheinClientCode(clientCode)) return 'shein'
  const normalized = clientCode?.trim().toUpperCase()
  if (normalized && priorityClientCodes?.has(normalized)) return 'local'
  return 'other'
}
