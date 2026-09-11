-- 24H 派签告警：是否在每张数据卡片后紧跟一张同站点供应商的实时排名卡
ALTER TABLE "dispatch_alarm_schedules" ADD COLUMN IF NOT EXISTS "ranking_card_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- 站点展示名：保存配置时从站点列表带上，排名卡标题用；为空时退回站点编码
ALTER TABLE "dispatch_alarm_schedules" ADD COLUMN IF NOT EXISTS "station_name" varchar(255) NOT NULL DEFAULT '';
