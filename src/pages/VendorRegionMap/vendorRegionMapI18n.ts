import { i18n } from '../../i18n'

export const VRM_NS = 'vendorRegionMap'

export function vrmT(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: VRM_NS, ...opts }))
}
