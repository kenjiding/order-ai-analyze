import { FEISHU_WEBHOOK_PREFIX } from './feishuPushTypes'

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
    rules.push({ required: true, message: '请填写群 webhook 地址' })
  }
  rules.push({
    validator: async (_: unknown, value: unknown) => {
      const v = typeof value === 'string' ? value.trim() : ''
      if (!v) return
      if (!v.startsWith(FEISHU_WEBHOOK_PREFIX)) {
        throw new Error(`地址需以飞书机器人前缀开头：${FEISHU_WEBHOOK_PREFIX}`)
      }
      let u: URL
      try {
        u = new URL(v)
      } catch {
        throw new Error('无效的 URL')
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error('仅支持 http(s) webhook')
      }
    },
  })
  return rules
}
