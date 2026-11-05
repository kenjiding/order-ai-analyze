-- 区域大盘清货数据推送：加上一次定时推送的快照，用于推送卡片展示跟上次推送的变化趋势

ALTER TABLE "region_clearance_push_schedules" ADD COLUMN IF NOT EXISTS "last_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "region_clearance_push_schedules" ADD COLUMN IF NOT EXISTS "last_snapshot_at" timestamp with time zone;
