CREATE TABLE IF NOT EXISTS "jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" varchar(128) NOT NULL,
  "region_code" varchar(16),
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "idempotency_key" varchar(255),
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" varchar(2048),
  "artifact_path" varchar(512),
  "artifact_expires_at" timestamp with time zone,
  "created_by" uuid,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "locked_by" varchar(128),
  "locked_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "jobs_idempotency_key_unique" ON "jobs" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "jobs_status_created_at_idx" ON "jobs" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "jobs_region_created_at_idx" ON "jobs" ("region_code", "created_at");
