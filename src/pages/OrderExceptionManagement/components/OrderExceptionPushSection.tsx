import { Select } from 'antd'
import { Bell, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { loadFeishuPushStore } from '../../PushNotifications/feishuPushRepository.idb'
import type { FeishuPushEntry } from '../../PushNotifications/feishuPushTypes'
import type { OrderExceptionPushRow } from '../orderExceptionApi'
import { postFeishuPushOrderException } from '../orderExceptionApi'

type AiProvider = 'deepseek' | 'openai'

type PushState = {
  loading: boolean
  success: boolean
  error: string
  aiGenerated: boolean
}

type Props = {
  /** 已完成分析的 done 行（过滤后） */
  doneRows: OrderExceptionPushRow[]
  analysisDate: string
}

export function OrderExceptionPushSection({ doneRows, analysisDate }: Props) {
  const { t } = useTranslation('orderException')
  const canPush = usePermission(PERMISSION_KEYS.btnPushNotificationsOrderException)
  const [entries, setEntries] = useState<FeishuPushEntry[]>([])
  const [aiProvider, setAiProvider] = useState<AiProvider>('deepseek')
  const [pushStates, setPushStates] = useState<Record<string, PushState>>({})

  useEffect(() => {
    void loadFeishuPushStore().then((store) => {
      setEntries(store.order_exception ?? [])
    })
  }, [])

  const handlePush = useCallback(
    async (entry: FeishuPushEntry) => {
      if (!canPush || doneRows.length === 0) return
      setPushStates((prev) => ({
        ...prev,
        [entry.id]: { loading: true, success: false, error: '', aiGenerated: false },
      }))
      try {
        const result = await postFeishuPushOrderException({
          pushScope: 'order-exception',
          webhookUrl: entry.webhookUrl,
          signingSecret: entry.signingSecret,
          rows: doneRows,
          analysisDate,
          aiProvider,
        })
        if (result.ok) {
          setPushStates((prev) => ({
            ...prev,
            [entry.id]: {
              loading: false,
              success: true,
              error: '',
              aiGenerated: result.aiSummaryGenerated ?? false,
            },
          }))
        } else {
          setPushStates((prev) => ({
            ...prev,
            [entry.id]: {
              loading: false,
              success: false,
              error: result.error ?? t('push.pushFailed'),
              aiGenerated: false,
            },
          }))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('push.pushFailed')
        setPushStates((prev) => ({
          ...prev,
          [entry.id]: { loading: false, success: false, error: msg, aiGenerated: false },
        }))
      }
    },
    [canPush, doneRows, analysisDate, aiProvider, t],
  )

  if (!canPush) return null
  if (doneRows.length === 0) return null

  return (
    <section className="admin-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[var(--admin-accent)]" />
          <h3 className="text-sm font-semibold text-slate-950">{t('push.title')}</h3>
          <span className="text-xs text-slate-400">{t('push.description')}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t('push.aiModel')}</span>
          <Select<AiProvider>
            value={aiProvider}
            onChange={setAiProvider}
            options={[
              { label: 'DeepSeek', value: 'deepseek' },
              { label: 'OpenAI', value: 'openai' },
            ]}
            className="w-28"
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">{t('push.noConfigHint')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-3">
          {entries
            .filter((e) => !e.isDisabled)
            .map((entry) => {
              const state = pushStates[entry.id]
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 rounded-lg border border-[var(--admin-line)] bg-white px-3 py-2"
                >
                  <span className="max-w-[160px] truncate text-xs font-medium text-slate-700">
                    {entry.pushName}
                  </span>
                  <button
                    type="button"
                    disabled={state?.loading}
                    onClick={() => void handlePush(entry)}
                    className={[
                      'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                      state?.loading
                        ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                        : 'bg-[var(--admin-accent)] text-white hover:bg-[var(--admin-accent-dark)]',
                    ].join(' ')}
                  >
                    <Send className="h-3 w-3" />
                    {state?.loading ? t('push.pushing') : t('push.push')}
                  </button>
                  {state?.success && (
                    <span className="text-xs text-green-600">
                      {t('push.pushed')}
                      {state.aiGenerated ? t('push.pushedWithAi') : ''}
                    </span>
                  )}
                  {state?.error && (
                    <span className="max-w-[200px] truncate text-xs text-red-500" title={state.error}>
                      {state.error}
                    </span>
                  )}
                </div>
              )
            })}
        </div>
      )}
    </section>
  )
}
