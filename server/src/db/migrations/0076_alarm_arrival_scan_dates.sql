-- 「立刻推送」的到件扫描时间改为多选：单日 varchar 换成 jsonb 日期数组（开发阶段不做旧值迁移）
ALTER TABLE "exit_alarm_schedules" DROP COLUMN IF EXISTS "arrival_scan_date";
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "arrival_scan_dates" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "dispatch_alarm_schedules" DROP COLUMN IF EXISTS "arrival_scan_date";
ALTER TABLE "dispatch_alarm_schedules" ADD COLUMN IF NOT EXISTS "arrival_scan_dates" jsonb NOT NULL DEFAULT '[]'::jsonb;
-- 派签告警落地页快照的日期可能是多个到件日拼接（如 2026-08-23 / 2026-08-24）
ALTER TABLE "dispatch_alarm_share_snapshots" ALTER COLUMN "date" TYPE varchar(64);
