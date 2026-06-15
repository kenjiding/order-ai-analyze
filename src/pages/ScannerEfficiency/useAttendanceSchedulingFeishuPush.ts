import { useCallback, useRef, useState } from 'react'
import { loadFeishuPushStore } from '../PushNotifications/feishuPushRepository.idb'
import { FEISHU_PUSH_KIND_LABELS } from '../PushNotifications/feishuPushTypes'
import {
  postFeishuPushImage,
  summarizeFeishuPushImageFailure,
} from '../PushNotifications/feishuWebhookTestApi'
import type { AttendanceSchedulingPlanPreview } from './attendanceSchedulingPlanPreviewModel'
import { captureScannerPushRegion, mergeImagesVertically } from './feishuLevel1ScreenshotCapture'
import { showToast } from '../../utils/toast'

const PUSH_ERROR_HINT =
  '请到「飞书推送 → 仓库出勤/排班推送」维护 webhook；若上载失败请在后端 .env 核对 FEISHU_APP_ID 与 FEISHU_APP_SECRET。'

function pushErrorToast(text: string) {
  showToast(`${text} ${PUSH_ERROR_HINT}`, 'error', 8)
}

export function useAttendanceSchedulingFeishuPush() {
  const previewCaptureRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const [pushing, setPushing] = useState(false)

  const setPreviewCaptureRef = useCallback((planDate: string, node: HTMLDivElement | null) => {
    previewCaptureRefs.current.set(planDate, node)
  }, [])

  const pushSchedulingPlanPreviews = useCallback(async (previews: AttendanceSchedulingPlanPreview[]) => {
    if (!previews.length) {
      showToast('统计窗口内无开仓日，无法推送排班计划。', 'error')
      return
    }

    const store = await loadFeishuPushStore()
    const entries = store.attendance_scheduling.filter((e) => e.webhookUrl.trim() && e.isDisabled !== true)
    if (!entries.length) {
      const kindLabel = FEISHU_PUSH_KIND_LABELS.attendance_scheduling
      pushErrorToast(`请先前往「飞书推送 → ${kindLabel}」配置并启用 webhook，至少保留一条可用条目。`)
      return
    }

    setPushing(true)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      const images: string[] = []
      for (const preview of previews) {
        const root = previewCaptureRefs.current.get(preview.planDate)
        if (!root) {
          pushErrorToast(`预览区域尚未就绪（${preview.title}）。`)
          return
        }
        try {
          images.push(await captureScannerPushRegion(root))
        } catch (err) {
          const hint = err instanceof Error ? err.message : String(err)
          pushErrorToast(`截图失败（${preview.title}）：${hint}`)
          return
        }
      }

      const mergedImg = images.length === 1 ? images[0]! : await mergeImagesVertically(images)
      const headlineText = `[仓库管理] ${previews.map((p) => p.title).join(' / ')}`

      const errors: string[] = []
      for (const entry of entries) {
        const name = entry.pushName.trim() || '未命名推送'
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

      const kindLabel = FEISHU_PUSH_KIND_LABELS.attendance_scheduling
      const base = `已向「${kindLabel}」配置的 ${entries.length} 条机器人推送 ${previews.length} 份排班计划截图。`
      if (errors.length === 0) {
        showToast(base, 'success', 6)
      } else if (errors.length >= entries.length) {
        pushErrorToast(errors.join(' '))
      } else {
        showToast(`部分失败：${errors.join(' ')}`, 'warning', 8)
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
