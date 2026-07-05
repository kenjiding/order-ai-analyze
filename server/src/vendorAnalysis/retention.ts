/** 供应商日报 + 分享链接保留期清理：仅保留最近 N 天（按开通时刻 createdAt，与「一周有效期」一致） */

import { lt } from 'drizzle-orm'
import { getDb, schema } from '../db'

export const VENDOR_REPORT_RETENTION_DAYS = 7

export async function purgeOldVendorDailyData(
  keepDays = VENDOR_REPORT_RETENTION_DAYS,
): Promise<{ reports: number; links: number }> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
  const db = getDb()
  const deletedLinks = await db
    .delete(schema.vendorShareLinks)
    .where(lt(schema.vendorShareLinks.createdAt, cutoff))
    .returning({ id: schema.vendorShareLinks.id })
  const deletedReports = await db
    .delete(schema.vendorDailyReports)
    .where(lt(schema.vendorDailyReports.createdAt, cutoff))
    .returning({ id: schema.vendorDailyReports.id })
  return { reports: deletedReports.length, links: deletedLinks.length }
}
