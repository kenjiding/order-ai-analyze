import { i18n } from '../../i18n'

export const PL_NS = 'packageLoss'

export function plT(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: PL_NS, ...opts }))
}
