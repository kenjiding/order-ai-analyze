import type { Request } from 'express'
import { normalizeImileToken } from '../imile/shared'

export function readImileTokenFromRequest(
  req: Request,
  bodyToken?: unknown,
  options?: { allowQuery?: boolean },
): string {
  const fromBody = String(bodyToken ?? '').trim()
  if (fromBody) return normalizeImileToken(fromBody)

  if (options?.allowQuery) {
    const fromQuery = String(req.query?.token ?? '').trim()
    if (fromQuery) return normalizeImileToken(fromQuery)
  }

  const authHeader = String(req.headers.authorization ?? '').trim()
  if (authHeader) return normalizeImileToken(authHeader)

  return ''
}
