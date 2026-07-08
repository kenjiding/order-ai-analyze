CREATE TABLE "vendor_analysis_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"region_code" varchar(16),
	"reference_date" varchar(10) NOT NULL,
	"station_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "imile_token" varchar(2048);--> statement-breakpoint
ALTER TABLE "vendor_analysis_snapshots" ADD CONSTRAINT "vendor_analysis_snapshots_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_analysis_snapshots" ADD CONSTRAINT "vendor_analysis_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_analysis_snapshots_job_id_idx" ON "vendor_analysis_snapshots" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "vendor_analysis_snapshots_reference_date_idx" ON "vendor_analysis_snapshots" USING btree ("reference_date","created_at");