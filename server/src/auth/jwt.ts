import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import type { Response } from 'express'
import type { UserRole } from '../permissions/registry'

export const AUTH_COOKIE_NAME = 'warehouse_auth'

export type AuthTokenPayload = {
  sub: string
  username: string
  role: UserRole
  regionCode: string | null
}

export type PublicUser = {
  id: string
  username: string
  displayName: string | null
  role: UserRole
  isActive: boolean
  regionCode: string | null
  regionName: string | null
}

function getJwtSecret(): string {
  const secret = String(process.env.JWT_SECRET ?? '').trim()
  if (!secret) {
    throw new Error('JWT_SECRET is not configured')
  }
  return secret
}

function getJwtExpiresIn(): string {
  return String(process.env.JWT_EXPIRES_IN ?? '7d').trim() || '7d'
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export function signAuthToken(payload: AuthTokenPayload): string {
  const expiresIn = getJwtExpiresIn()
  return jwt.sign(payload, getJwtSecret(), { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] })
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as AuthTokenPayload
    if (!decoded?.sub || !decoded?.username || !decoded?.role) return null
    return decoded
  } catch {
    return null
  }
}

export function setAuthCookie(res: Response, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production'
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' })
}

export function toPublicUser(user: {
  id: string
  username: string
  displayName: string | null
  role: string
  isActive: boolean
  regionId: string | null
  regionName?: string | null
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as UserRole,
    isActive: user.isActive,
    regionCode: user.regionId,
    regionName: user.regionName ?? null,
  }
}
