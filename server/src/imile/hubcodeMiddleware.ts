import type { NextFunction, Request, Response } from 'express'
import {
  isImileCountryCode,
  runWithImileCountry,
  runWithImileHubcode,
} from './shared'

/**
 * 将前端「站点选择器」的 hubcode、「国家选择器」的 country 请求头
 * 注入 AsyncLocalStorage，使本次请求内 iMile 调用自动取用，
 * 无需逐个业务文件手动透传。
 */
export function imileHubcodeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const hubcode = String(req.headers['hubcode'] ?? '').trim()
  const countryRaw = String(req.headers['country'] ?? '').trim().toUpperCase()
  const country = isImileCountryCode(countryRaw) ? countryRaw : ''

  const withCountry = (fn: NextFunction) => {
    if (!country) {
      fn()
      return
    }
    runWithImileCountry(country, fn)
  }

  if (!hubcode) {
    withCountry(next)
    return
  }
  runWithImileHubcode(hubcode, () => withCountry(next))
}
