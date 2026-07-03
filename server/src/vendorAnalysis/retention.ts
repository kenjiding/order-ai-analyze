/** 供应商日报 + 分享链接保留期清理：仅保留最近 N 天（按业务日期 reportDate，非 createdAt） */

import { lt } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { utcMsToLocalStr, INBOUND_INDEX_ADELAIDE_TZ } from '../imile/inboundWaybillIndex'

export const VENDOR_REPORT_RETENTION_DAYS = 7

export async function purgeOldVendorDailyData(
  keepDays = VENDOR_REPORT_RETENTION_DAYS,
): Promise<{ reports: number; links: number }> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - keepDays)
  const cutoffDate = utcMsToLocalStr(cutoff.getTime(), INBOUND_INDEX_ADELAIDE_TZ).slice(0, 10)
  const db = getDb()
  const deletedLinks = await db
    .delete(schema.vendorShareLinks)
    .where(lt(schema.vendorShareLinks.reportDate, cutoffDate))
    .returning({ id: schema.vendorShareLinks.id })
  const deletedReports = await db
    .delete(schema.vendorDailyReports)
    .where(lt(schema.vendorDailyReports.reportDate, cutoffDate))
    .returning({ id: schema.vendorDailyReports.id })
  return { reports: deletedReports.length, links: deletedLinks.length }
}
