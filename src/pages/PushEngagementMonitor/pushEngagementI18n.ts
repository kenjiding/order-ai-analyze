import { i18n } from '../../i18n'

export const PE_NS = 'pushEngagement'

export function peT(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: PE_NS, ...opts }))
}
