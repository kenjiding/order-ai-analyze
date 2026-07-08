CREATE TABLE "feishu_push_snapshots" (
  "region_code" varchar(16) PRIMARY KEY NOT NULL,
  "period_label" varchar(255) NOT NULL DEFAULT '',
  "snapshot" jsonb NOT NULL,
  "pushed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
