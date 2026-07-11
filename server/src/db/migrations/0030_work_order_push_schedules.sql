-- 工单推送：定时推送配置表（每个账号最多一条，userId 唯一）
-- 复用「11点前出仓告警」/「催派推送」的供应商配置 catalog；本表仅存该业务的定时设置。

CREATE TABLE IF NOT EXISTS "work_order_push_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"push_time" varchar(5) DEFAULT '09:00' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"imile_token" varchar(2048),
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_order_push_schedules" ADD CONSTRAINT "work_order_push_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "work_order_push_schedules" ADD CONSTRAINT "work_order_push_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_push_schedules_user_id_unique" ON "work_order_push_schedules" USING btree ("user_id");
