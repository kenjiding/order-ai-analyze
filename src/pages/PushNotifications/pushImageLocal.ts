/** 与 server `push-image` 校验一致（飞书单图约 10MB 上限） */
export const FEISHU_PUSH_IMAGE_MAX_BYTES = 9 * 1024 * 1024

export type LocalPushImage = {
  id: string
  name: string
  dataUrl: string
}

export async function readLocalPushImage(file: File): Promise<LocalPushImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`「${file.name}」不是图片文件。`)
  }
  if (file.size > FEISHU_PUSH_IMAGE_MAX_BYTES) {
    throw new Error(`「${file.name}」超过 9MB，请压缩后重试。`)
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error(`无法读取「${file.name}」。`))
    }
    reader.onerror = () => reject(new Error(`无法读取「${file.name}」。`))
    reader.readAsDataURL(file)
  })
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: file.name,
    dataUrl,
  }
}
