CREATE TABLE IF NOT EXISTS "station_inbound_waybill_index" (
	"station_code" varchar(64) NOT NULL,
	"data_date" varchar(10) NOT NULL,
	"waybill_nos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"waybill_count" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "station_inbound_waybill_index_station_date" ON "station_inbound_waybill_index" USING btree ("station_code","data_date");--> statement-breakpoint
ALTER TABLE "exit_alarm_schedules" DROP COLUMN IF EXISTS "inbound_cache_date";--> statement-breakpoint
ALTER TABLE "exit_alarm_schedules" DROP COLUMN IF EXISTS "inbound_waybill_nos";--> statement-breakpoint
ALTER TABLE "exit_alarm_schedules" DROP COLUMN IF EXISTS "inbound_cached_at";
