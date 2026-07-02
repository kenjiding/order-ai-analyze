ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "push_config_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
