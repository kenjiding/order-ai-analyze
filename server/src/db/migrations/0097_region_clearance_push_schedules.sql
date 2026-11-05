-- 区域大盘清货数据推送：按大区的定时推送配置表（一个账号可有多条，按大区区分）

CREATE TABLE IF NOT EXISTS "region_clearance_push_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"region_code" varchar(64) DEFAULT '' NOT NULL,
	"region_name" varchar(128) DEFAULT '' NOT NULL,
	"station_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"push_times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"chat_id" varchar(128) DEFAULT '' NOT NULL,
	"mention_open_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imile_token" varchar(2048),
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "region_clearance_push_schedules" ADD CONSTRAINT "region_clearance_push_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "region_clearance_push_schedules" ADD CONSTRAINT "region_clearance_push_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
