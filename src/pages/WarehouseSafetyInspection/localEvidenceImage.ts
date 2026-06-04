export const EVIDENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export type LocalEvidenceImage = {
  id: string
  name: string
  dataUrl: string
}

const IMAGE_EXT_PATTERN = /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i

function isLikelyImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return IMAGE_EXT_PATTERN.test(file.name)
}

export async function readLocalEvidenceImage(file: File): Promise<LocalEvidenceImage> {
  if (!isLikelyImageFile(file)) {
    throw new Error(`「${file.name}」不是图片文件。`)
  }
  if (file.size > EVIDENCE_IMAGE_MAX_BYTES) {
    throw new Error(`「${file.name}」超过 8MB，请压缩后重试。`)
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

export function parseDataUrlForExcel(dataUrl: string): { base64: string; extension: 'png' | 'jpeg' | 'gif' } {
  const match = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(dataUrl)
  if (!match) {
    throw new Error('不支持的图片格式')
  }
  const rawExt = match[1].toLowerCase()
  const extension: 'png' | 'jpeg' | 'gif' =
    rawExt === 'png' ? 'png' : rawExt === 'gif' ? 'gif' : 'jpeg'
  return { base64: match[2], extension }
}
