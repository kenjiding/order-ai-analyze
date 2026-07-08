CREATE TABLE "order_exception_warehouse_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "config_key" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "saved_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "order_exception_warehouse_configs_saved_by_users_id_fk"
    FOREIGN KEY ("saved_by") REFERENCES "users"("id") ON DELETE set null
);
CREATE UNIQUE INDEX "order_exception_warehouse_configs_key_unique"
  ON "order_exception_warehouse_configs" ("config_key");
