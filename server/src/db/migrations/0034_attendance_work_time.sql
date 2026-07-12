-- 出勤工作时间记录：人员名单（按 region_code 隔离，同州内姓名唯一）+ 单次工序/岗位工作时长记录。
-- zkt_emp_code / source 字段为后续联动 ZKT 考勤 API 预留。

CREATE TABLE IF NOT EXISTS "attendance_workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_code" varchar(16) NOT NULL,
	"name" varchar(128) NOT NULL,
	"zkt_emp_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_work_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_code" varchar(16) NOT NULL,
	"worker_id" uuid NOT NULL,
	"process_category" varchar(32) NOT NULL,
	"shift" varchar(16) NOT NULL,
	"zone_code" varchar(64),
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"notes" text,
	"source" varchar(16) DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_work_records" ADD CONSTRAINT "attendance_work_records_worker_id_attendance_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."attendance_workers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attendance_work_records" ADD CONSTRAINT "attendance_work_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_workers_region_name_unique" ON "attendance_workers" USING btree ("region_code","name");
--> statement-breakpoint
CREATE INDEX "attendance_workers_region_idx" ON "attendance_workers" USING btree ("region_code");
--> statement-breakpoint
CREATE INDEX "attendance_work_records_region_start_idx" ON "attendance_work_records" USING btree ("region_code","start_time");
--> statement-breakpoint
CREATE INDEX "attendance_work_records_worker_idx" ON "attendance_work_records" USING btree ("worker_id");
