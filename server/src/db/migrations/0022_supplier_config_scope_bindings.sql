CREATE TABLE IF NOT EXISTS "supplier_config_scope_bindings" (
  "scope_key" varchar(64) PRIMARY KEY,
  "enabled_config_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
