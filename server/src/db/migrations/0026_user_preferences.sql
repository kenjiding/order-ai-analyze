CREATE TABLE IF NOT EXISTS "user_preferences" (
  "user_id" uuid NOT NULL,
  "pref_key" varchar(128) NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_preferences_user_id_pref_key_pk" PRIMARY KEY ("user_id", "pref_key")
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
