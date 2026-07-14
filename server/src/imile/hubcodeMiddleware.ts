import type { NextFunction, Request, Response } from 'express'
import { runWithImileHubcode } from './shared'

/**
 * 将前端「站点选择器」传来的 hubcode 请求头注入 AsyncLocalStorage，
 * 使本次请求内所有 buildImileAuthHeaders / buildImilePortalHeaders 调用
 * 自动带上该 hubcode，无需逐个 iMile 业务文件手动透传。
 */
export function imileHubcodeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const hubcode = String(req.headers['hubcode'] ?? '').trim()
  if (!hubcode) {
    next()
    return
  }
  runWithImileHubcode(hubcode, next)
}
