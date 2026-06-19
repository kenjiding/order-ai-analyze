import { useCallback, useEffect, useState } from 'react'
import {
  postFeishuPushCard,
  summarizeFeishuTestFailure,
} from '../PushNotifications/feishuWebhookTestApi'
import { showToast } from '../../utils/toast'
import { buildNewMerchantCard, type BuildNewMerchantCardInput } from './buildNewMerchantCard'

const STORAGE_KEY = 'new-merchant-feishu-push-config-v1'
const WEBHOOK_PREFIX = 'https://open.feishu.cn/open-apis/bot/v2/hook/'

export type NewMerchantPushConfig = {
  webhookUrl: string
  signingSecret: string
  pushName: string
}

const DEFAULT_CONFIG: NewMerchantPushConfig = {
  webhookUrl: '',
  signingSecret: '',
  pushName: '新商家数据监控',
}

function readStoredConfig(): NewMerchantPushConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CONFIG
    const parsed = JSON.parse(raw) as Partial<NewMerchantPushConfig>
    return {
      webhookUrl: typeof parsed.webhookUrl === 'string' ? parsed.webhookUrl : '',
      signingSecret: typeof parsed.signingSecret === 'string' ? parsed.signingSecret : '',
      pushName:
        typeof parsed.pushName === 'string' && parsed.pushName.trim()
          ? parsed.pushName
          : DEFAULT_CONFIG.pushName,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

function persistConfig(cfg: NewMerchantPushConfig): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

export type UseNewMerchantFeishuPushArgs = {
  /** 构建卡片所需的所有数据；外部在每次 records 变化时刷新即可 */
  buildPayload: () => Omit<BuildNewMerchantCardInput, 'title'> | null
}

export function useNewMerchantFeishuPush({ buildPayload }: UseNewMerchantFeishuPushArgs) {
  const [config, setConfig] = useState<NewMerchantPushConfig>(() => readStoredConfig())
  const [pushing, setPushing] = useState(false)

  useEffect(() => {
    persistConfig(config)
  }, [config])

  const updateConfig = useCallback((patch: Partial<NewMerchantPushConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }))
  }, [])

  const handlePush = useCallback(async () => {
    const webhookUrl = config.webhookUrl.trim()
    if (!webhookUrl) {
      showToast('请填写飞书 webhook 地址', 'warning')
      return
    }
    if (!webhookUrl.startsWith(WEBHOOK_PREFIX)) {
      showToast('webhook 地址需以 open.feishu.cn/open-apis/bot/v2/hook/ 开头', 'warning')
      return
    }

    const payload = buildPayload()
    if (!payload) {
      showToast('请先查询数据后再推送', 'warning')
      return
    }

    setPushing(true)
    try {
      const card = buildNewMerchantCard({
        ...payload,
        title: config.pushName.trim() || DEFAULT_CONFIG.pushName,
      })
      const result = await postFeishuPushCard({
        pushScope: 'warehouse-efficiency',
        webhookUrl,
        signingSecret: config.signingSecret.trim() || undefined,
        card,
      })
      if (result.ok) {
        showToast('已推送到飞书群', 'success')
      } else {
        showToast(summarizeFeishuTestFailure(result), 'error', 8)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '推送失败'
      showToast(msg, 'error', 6)
    } finally {
      setPushing(false)
    }
  }, [buildPayload, config.pushName, config.signingSecret, config.webhookUrl])

  return {
    config,
    updateConfig,
    pushing,
    handlePush,
  }
}

export type NewMerchantFeishuPush = ReturnType<typeof useNewMerchantFeishuPush>
