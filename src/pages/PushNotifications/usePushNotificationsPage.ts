import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadFeishuPushStore, persistFeishuPushStore } from './feishuPushRepository.idb'
import { emptyFeishuPushStore } from './feishuPushStorage'
import {
  FEISHU_PUSH_KIND_ORDER,
  type FeishuPushEntry,
  type FeishuPushEntryWithKind,
  type FeishuPushKind,
} from './feishuPushTypes'
import type { PushEntryDraft } from './pushEntryFormTransforms'
import { showToast } from '../../utils/toast'

export function usePushNotificationsPage() {
  const { t } = useTranslation('pushNotifications')
  const [configs, setConfigs] = useState(emptyFeishuPushStore)

  useEffect(() => {
    void loadFeishuPushStore().then(setConfigs)
  }, [])

  const entriesWithKind = useMemo(() => {
    const out: FeishuPushEntryWithKind[] = []
    for (const k of FEISHU_PUSH_KIND_ORDER) {
      for (const e of configs[k]) {
        out.push({ ...e, kind: k })
      }
    }
    return out
  }, [configs])

  const onPersistFailed = useCallback(async () => {
    showToast(t('toast.saveFailed'), 'error')
    setConfigs(await loadFeishuPushStore())
  }, [t])

  const upsertEntry = useCallback((entry: PushEntryDraft, previousKind?: FeishuPushKind) => {
    setConfigs((prev) => {
      const sourceKind = previousKind ?? entry.kind
      const targetKind = entry.kind
      const nextEntry: FeishuPushEntry = {
        id: entry.id,
        webhookUrl: entry.webhookUrl,
        pushName: entry.pushName,
        pushTimeHm: entry.pushTimeHm,
        isDisabled: entry.isDisabled === true,
        signingSecret: entry.signingSecret,
        pushDescription: entry.pushDescription,
      }

      const sourceList = [...prev[sourceKind]]
      const sourceIdx = sourceList.findIndex((x) => x.id === entry.id)
      if (sourceIdx !== -1) {
        sourceList.splice(sourceIdx, 1)
      }

      const targetList = sourceKind === targetKind ? sourceList : [...prev[targetKind]]
      const idx = targetList.findIndex((x) => x.id === entry.id)
      if (idx === -1) {
        targetList.push(nextEntry)
      } else {
        targetList[idx] = nextEntry
      }
      const nextConfigs =
        sourceKind === targetKind
          ? { ...prev, [sourceKind]: targetList }
          : { ...prev, [sourceKind]: sourceList, [targetKind]: targetList }

      void persistFeishuPushStore(nextConfigs).catch(() => void onPersistFailed())
      return nextConfigs
    })
  }, [onPersistFailed])

  const deleteEntryById = useCallback((id: string) => {
    setConfigs((prev) => {
      let foundKind: FeishuPushKind | null = null
      for (const k of FEISHU_PUSH_KIND_ORDER) {
        if (prev[k].some((x) => x.id === id)) {
          foundKind = k
          break
        }
      }
      if (!foundKind) return prev

      const nextConfigs = {
        ...prev,
        [foundKind]: prev[foundKind].filter((x) => x.id !== id),
      }
      void persistFeishuPushStore(nextConfigs).catch(() => void onPersistFailed())
      return nextConfigs
    })
  }, [onPersistFailed])

  const toggleEntryDisabled = useCallback((id: string, disabled: boolean) => {
    setConfigs((prev) => {
      let changed = false
      const next = { ...prev }
      for (const k of FEISHU_PUSH_KIND_ORDER) {
        const list = prev[k]
        const idx = list.findIndex((x) => x.id === id)
        if (idx === -1) continue
        const current = list[idx]
        if ((current.isDisabled === true) === disabled) return prev
        const nextList = [...list]
        nextList[idx] = { ...current, isDisabled: disabled }
        next[k] = nextList
        changed = true
        break
      }
      if (!changed) return prev
      void persistFeishuPushStore(next).catch(() => void onPersistFailed())
      return next
    })
  }, [onPersistFailed])

  return {
    entriesWithKind,
    upsertEntry,
    deleteEntryById,
    toggleEntryDisabled,
    storedTotalCount: entriesWithKind.length,
  }
}
