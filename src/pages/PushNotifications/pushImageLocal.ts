import { i18n } from '../../i18n/index'

/** 与 server `push-image` 校验一致（飞书单图约 10MB 上限） */
export const FEISHU_PUSH_IMAGE_MAX_BYTES = 9 * 1024 * 1024

const pt = (key: string, options?: Record<string, unknown>) =>
  String(i18n.t(key, { ns: 'pushNotifications', ...options }))

export type LocalPushImage = {
  id: string
  name: string
  dataUrl: string
}

export async function readLocalPushImage(file: File): Promise<LocalPushImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error(pt('pushImage.notImage', { name: file.name }))
  }
  if (file.size > FEISHU_PUSH_IMAGE_MAX_BYTES) {
    throw new Error(pt('pushImage.tooLarge', { name: file.name }))
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error(pt('pushImage.readFailed', { name: file.name })))
    }
    reader.onerror = () => reject(new Error(pt('pushImage.readFailed', { name: file.name })))
    reader.readAsDataURL(file)
  })
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: file.name,
    dataUrl,
  }
}
