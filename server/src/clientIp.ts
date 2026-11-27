import type { Request } from 'express'

/** CF-Connecting-IP 由 Cloudflare 边缘写入；源站一旦直接暴露公网，nginx 必须对非 Cloudflare 来源覆盖此头，否则限流可被绕过。 */
export function clientIp(req: Request): string | null {
  const forwarded = req.get('cf-connecting-ip')?.trim()
  if (forwarded) return forwarded
  const direct = req.ip
  if (!direct) return null
  return direct.startsWith('::ffff:') ? direct.slice('::ffff:'.length) : direct
}
