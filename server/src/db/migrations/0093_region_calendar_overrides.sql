-- 出仓/派送日历的例外表：只存「跟默认规则不一样」的那一天（默认周一到周五都能出仓/能派送）。
-- 公共假期（分拣/派送停摆但早取照常）只覆盖 is_dispatch_day；周末临时开仓分拣（出仓跟着开，
-- 司机未必加派）只覆盖 is_exit_day。两列各自独立、互不牵连，按 (region_code, date) 查——
-- 公共假期按澳洲各州各自的法定假日表，不是全国统一。
CREATE TABLE IF NOT EXISTS "region_calendar_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "region_code" varchar(32) NOT NULL,
  "date" varchar(10) NOT NULL,
  "is_exit_day" boolean,
  "is_dispatch_day" boolean,
  "note" varchar(255) DEFAULT '' NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "region_calendar_overrides_region_date_unique"
  ON "region_calendar_overrides" ("region_code", "date");
