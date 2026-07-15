-- 24小时派签告警外部分享快照：群内链接无登录查看未达标运单明细
CREATE TABLE IF NOT EXISTS "dispatch_alarm_share_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token" varchar(128) NOT NULL,
  "vendor_code" varchar(64) NOT NULL,
  "vendor_name" varchar(255) NOT NULL,
  "station_code" varchar(64) NOT NULL,
  "date" varchar(10) NOT NULL,
  "push_time" varchar(8) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_accessed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_alarm_share_snapshots_token_unique" ON "dispatch_alarm_share_snapshots" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_alarm_share_snapshots_created_at_idx" ON "dispatch_alarm_share_snapshots" USING btree ("created_at");
