import { Button, Input } from 'antd'
import { Send } from 'lucide-react'
import type { NewMerchantPushConfig } from '../useNewMerchantFeishuPush'

type Props = {
  config: NewMerchantPushConfig
  onChange: (patch: Partial<NewMerchantPushConfig>) => void
  pushing: boolean
  disabled: boolean
  onPush: () => void
}

export default function NewMerchantPushBar({ config, onChange, pushing, disabled, onPush }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-700">飞书推送</div>
          <div className="text-xs text-slate-500">
            将当前查询结果以图文卡片推送到飞书群，复用项目内统一推送通道
          </div>
        </div>
        <Button
          type="primary"
          icon={<Send className="h-4 w-4" aria-hidden />}
          loading={pushing}
          disabled={disabled}
          onClick={onPush}
        >
          推送到飞书
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Webhook 地址 <span className="text-red-500">*</span>
          </label>
          <Input
            value={config.webhookUrl}
            onChange={(e) => onChange({ webhookUrl: e.target.value })}
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx"
            allowClear
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">签名密钥（可选）</label>
          <Input.Password
            value={config.signingSecret}
            onChange={(e) => onChange({ signingSecret: e.target.value })}
            placeholder="若群机器人开启签名校验则填写"
            allowClear
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">推送标题</label>
          <Input
            value={config.pushName}
            onChange={(e) => onChange({ pushName: e.target.value })}
            placeholder="新商家数据监控"
            allowClear
          />
        </div>
      </div>
      <div className="mt-2 text-[11px] text-slate-400">
        配置自动保存在浏览器本地；权限要求：「物流运营推送」api scope。
      </div>
    </div>
  )
}
