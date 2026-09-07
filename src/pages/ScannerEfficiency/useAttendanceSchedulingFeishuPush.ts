import { useCallback, useRef, useState } from 'react'
import { i18n } from '../../i18n/index'
import { loadFeishuPushStore } from '../PushNotifications/feishuPushRepository.idb'
import { feishuPushKindLabel } from '../PushNotifications/feishuPushTypes'
import {
  postFeishuPushImage,
  summarizeFeishuPushImageFailure,
} from '../PushNotifications/feishuWebhookTestApi'
import type { AttendanceSchedulingPlanPreview } from './attendanceSchedulingPlanPreviewModel'
import { captureScannerPushRegion, mergeImagesVertically } from './feishuLevel1ScreenshotCapture'
import { showToast } from '../../utils/toast'

function t(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: 'scannerEfficiency', ...options }))
}

function pushErrorToast(text: string) {
  showToast(`${text} ${t('scheduling.errorHint')}`, 'error', 8)
}

export function useAttendanceSchedulingFeishuPush() {
  const previewCaptureRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const [pushing, setPushing] = useState(false)

  const setPreviewCaptureRef = useCallback((planDate: string, node: HTMLDivElement | null) => {
    previewCaptureRefs.current.set(planDate, node)
  }, [])

  const pushSchedulingPlanPreviews = useCallback(async (previews: AttendanceSchedulingPlanPreview[]) => {
    if (!previews.length) {
      showToast(t('scheduling.noOpenDays'), 'error')
      return
    }

    const store = await loadFeishuPushStore()
    const entries = store.attendance_scheduling.filter((e) => e.webhookUrl.trim() && e.isDisabled !== true)
    if (!entries.length) {
      const kindLabel = feishuPushKindLabel('attendance_scheduling')
      pushErrorToast(t('scheduling.configureWebhook', { kind: kindLabel }))
      return
    }

    setPushing(true)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      const images: string[] = []
      for (const preview of previews) {
        const root = previewCaptureRefs.current.get(preview.planDate)
        if (!root) {
          pushErrorToast(t('scheduling.previewNotReady', { title: preview.title }))
          return
        }
        try {
          images.push(await captureScannerPushRegion(root))
        } catch (err) {
          const hint = err instanceof Error ? err.message : String(err)
          pushErrorToast(t('scheduling.screenshotFailed', { title: preview.title, hint }))
          return
        }
      }

      const mergedImg = images.length === 1 ? images[0]! : await mergeImagesVertically(images)
      const headlineText = t('scheduling.headline', { titles: previews.map((p) => p.title).join(' / ') })

      const errors: string[] = []
      for (const entry of entries) {
        const name = entry.pushName.trim() || t('push.unnamedPush')
        const pushRes = await postFeishuPushImage({
          pushScope: 'attendance-scheduling',
          webhookUrl: entry.webhookUrl,
          signingSecret: entry.signingSecret,
          imageBase64: mergedImg,
          headlineText,
        })
        if (pushRes.ok === false) {
          errors.push(`「${name}」：${summarizeFeishuPushImageFailure(pushRes)}`)
        }
      }

      const kindLabel = feishuPushKindLabel('attendance_scheduling')
      const base = t('scheduling.successBase', { kind: kindLabel, count: entries.length, plans: previews.length })
      if (errors.length === 0) {
        showToast(base, 'success', 6)
      } else if (errors.length >= entries.length) {
        pushErrorToast(errors.join(' '))
      } else {
        showToast(t('push.partialFailed', { errors: errors.join(' ') }), 'warning', 8)
      }
    } finally {
      setPushing(false)
    }
  }, [])

  return {
    pushing,
    setPreviewCaptureRef,
    pushSchedulingPlanPreviews,
  }
}
