import { i18n } from '../../i18n'

export const VA_NS = 'vendorAnalysis'

export function vaT(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: VA_NS, ...opts }))
}
