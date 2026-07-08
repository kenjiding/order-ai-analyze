CREATE TABLE "fleet_supplier_push_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"supplier_name" varchar(255) NOT NULL,
	"route_code" varchar(1024) DEFAULT '' NOT NULL,
	"webhook_url" varchar(512) DEFAULT '' NOT NULL,
	"signing_secret" varchar(255),
	"push_content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleet_supplier_push_configs" ADD CONSTRAINT "fleet_supplier_push_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_supplier_push_configs_user_idx" ON "fleet_supplier_push_configs" USING btree ("user_id");