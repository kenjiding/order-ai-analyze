CREATE TABLE IF NOT EXISTS "regions" (
  "code" varchar(16) PRIMARY KEY NOT NULL,
  "name" varchar(128) NOT NULL,
  "name_en" varchar(128),
  "sort_order" integer DEFAULT 0 NOT NULL
);

INSERT INTO "regions" ("code", "name", "name_en", "sort_order") VALUES
  ('system', '系统管理', 'System Admin', 0),
  ('NSW', '新南威尔士州', 'New South Wales', 10),
  ('VIC', '维多利亚州', 'Victoria', 20),
  ('QLD', '昆士兰州', 'Queensland', 30),
  ('SA', '南澳大利亚州', 'South Australia', 40),
  ('WA', '西澳大利亚州', 'Western Australia', 50),
  ('TAS', '塔斯马尼亚州', 'Tasmania', 60),
  ('ACT', '首都领地', 'Australian Capital Territory', 70),
  ('NT', '北领地', 'Northern Territory', 80)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "name_en" = EXCLUDED."name_en",
  "sort_order" = EXCLUDED."sort_order";

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" varchar(64);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "region_id" varchar(16);

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_region_id_regions_code_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("code") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

UPDATE "users"
SET "username" = lower(split_part("email", '@', 1))
WHERE "username" IS NULL AND "email" IS NOT NULL;

UPDATE "users"
SET "region_id" = NULL
WHERE "role" = 'super_admin';

UPDATE "users"
SET "region_id" = 'NSW'
WHERE "region_id" IS NULL AND "role" <> 'super_admin';

UPDATE "users"
SET "username" = COALESCE("username", 'user_' || substr(id::text, 1, 8))
WHERE "username" IS NULL;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";
ALTER TABLE "users" DROP COLUMN IF EXISTS "email";

CREATE UNIQUE INDEX IF NOT EXISTS "users_region_username_unique"
  ON "users" ("region_id", "username")
  WHERE "region_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_system_username_unique"
  ON "users" ("username")
  WHERE "region_id" IS NULL;
