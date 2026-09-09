-- 24H 派签告警：是否剔除路由码白名单数据（默认剔除，与既有推送口径一致）
ALTER TABLE "dispatch_alarm_schedules" ADD COLUMN IF NOT EXISTS "exclude_whitelist" boolean NOT NULL DEFAULT true;
