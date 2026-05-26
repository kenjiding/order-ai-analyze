import { FEISHU_WEBHOOK_PREFIX } from './feishuPushTypes'

/** antd Form 规则：飞书 webhook 校验 */
export function webhookFieldRules(): Array<
  | { required: true; message: string }
  | { validator: (_: unknown, value: unknown) => Promise<void> }
> {
  return [
    { required: true, message: '请填写群 webhook 地址' },
    {
      validator: async (_: unknown, value: unknown) => {
        const v = typeof value === 'string' ? value.trim() : ''
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
    },
  ]
}
