ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "inbound_cache_date" varchar(10);--> statement-breakpoint
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "inbound_waybill_nos" jsonb;--> statement-breakpoint
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "inbound_cached_at" timestamp with time zone;
