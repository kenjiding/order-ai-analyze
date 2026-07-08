CREATE TABLE IF NOT EXISTS "efficiency_attendance_daily_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "record_date" varchar(10) NOT NULL,
  "region_code" varchar(16) DEFAULT 'global' NOT NULL,
  "payload" jsonb NOT NULL,
  "saved_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "efficiency_attendance_daily_records" ADD CONSTRAINT "efficiency_attendance_daily_records_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "efficiency_attendance_daily_records_date_region_unique" ON "efficiency_attendance_daily_records" ("record_date", "region_code");
CREATE INDEX IF NOT EXISTS "efficiency_attendance_daily_records_region_updated_idx" ON "efficiency_attendance_daily_records" ("region_code", "updated_at");
