/** PDA 一次推送最多带几张现场照片（飞书卡片体积 + 上传耗时） */
export const DELIVERING_NOTIFY_MAX_PHOTOS = 6

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

/**
 * 仓前台拍照多为几 MB 的 JPEG/HEIC。压缩后再走 JSON，避免撑爆请求，也贴合飞书 10MB 上传上限。
 */
export async function compressCameraPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/') && file.type !== '') {
    throw new Error('请选择照片')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法压缩照片')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } finally {
    bitmap.close()
  }
}
