DROP INDEX IF EXISTS "users_region_username_unique";
DROP INDEX IF EXISTS "users_system_username_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username");
