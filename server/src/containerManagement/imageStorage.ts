/**
 * 容器管理：接收方差异申报证据图片的本地磁盘存储。
 * 前端已把图片压缩成 dataURL 随 JSON 提交，这里解码校验后落盘，只把 URL 存进数据库。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { ContainerBusinessError } from './accountService'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** 依据文件头判断真实类型，不信任 dataURL 里声明的 mime */
const MAGIC: { ext: string; test: (buf: Buffer) => boolean }[] = [
  { ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.gif', test: (b) => b.subarray(0, 6).toString('latin1').startsWith('GIF8') },
  {
    ext: '.webp',
    test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
]

const CONTENT_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

const FILE_NAME_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|gif|webp)$/

export function getUploadDir(): string {
  const configured = String(process.env.CONTAINER_UPLOAD_DIR ?? '').trim()
  return configured ? resolve(configured) : resolve(process.cwd(), 'upload-storage/container-images')
}

export function buildImageUrl(fileName: string): string {
  return `/api/container-management/images/${fileName}`
}

export async function saveImageFromDataUrl(dataUrl: string): Promise<string> {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) throw new ContainerBusinessError('图片格式不正确，请重新选择')

  let buffer: Buffer
  try {
    buffer = Buffer.from(match[1], 'base64')
  } catch {
    throw new ContainerBusinessError('图片解码失败，请重新选择')
  }
  if (buffer.length === 0) throw new ContainerBusinessError('图片内容为空')
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ContainerBusinessError('图片超过 5MB，请压缩后再上传')
  }

  const matched = MAGIC.find((item) => item.test(buffer))
  if (!matched) throw new ContainerBusinessError('仅支持 jpg / png / gif / webp 图片')

  const dir = getUploadDir()
  await mkdir(dir, { recursive: true })
  const fileName = `${randomUUID()}${matched.ext}`
  await writeFile(join(dir, fileName), buffer)
  return buildImageUrl(fileName)
}

export async function readImage(fileName: string): Promise<{ buffer: Buffer; contentType: string }> {
  // 文件名白名单校验，杜绝路径穿越
  if (!FILE_NAME_PATTERN.test(fileName)) {
    throw new ContainerBusinessError('图片不存在', 404)
  }
  const filePath = join(getUploadDir(), fileName)
  try {
    const buffer = await readFile(filePath)
    return { buffer, contentType: CONTENT_TYPE[extname(fileName)] ?? 'application/octet-stream' }
  } catch {
    throw new ContainerBusinessError('图片不存在', 404)
  }
}
