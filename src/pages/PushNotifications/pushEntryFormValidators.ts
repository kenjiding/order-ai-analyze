import { i18n } from '../../i18n/index'
import { FEISHU_WEBHOOK_PREFIX } from './feishuPushTypes'

const pt = (key: string, options?: Record<string, unknown>) =>
  String(i18n.t(key, { ns: 'pushNotifications', ...options }))

/** antd Form 规则：飞书 webhook 校验；`required` 默认 true，传 false 则允许留空（留空时跳过格式校验） */
export function webhookFieldRules(required = true): Array<
  | { required: true; message: string }
  | { validator: (_: unknown, value: unknown) => Promise<void> }
> {
  const rules: Array<
    | { required: true; message: string }
    | { validator: (_: unknown, value: unknown) => Promise<void> }
  > = []
  if (required) {
    rules.push({ required: true, message: pt('validation.webhookRequired') })
  }
  rules.push({
    validator: async (_: unknown, value: unknown) => {
      const v = typeof value === 'string' ? value.trim() : ''
      if (!v) return
      if (!v.startsWith(FEISHU_WEBHOOK_PREFIX)) {
        throw new Error(pt('validation.webhookPrefix', { prefix: FEISHU_WEBHOOK_PREFIX }))
      }
      let u: URL
      try {
        u = new URL(v)
      } catch {
        throw new Error(pt('validation.invalidUrl'))
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error(pt('validation.httpOnly'))
      }
    },
  })
  return rules
}
