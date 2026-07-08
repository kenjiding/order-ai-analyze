CREATE TABLE "vendor_analysis_push_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_code" varchar(64) NOT NULL,
	"vendor_name" varchar(255) NOT NULL,
	"webhook_url" varchar(512) NOT NULL,
	"signing_secret" varchar(255),
	"push_description" varchar(512),
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_analysis_push_configs" ADD CONSTRAINT "vendor_analysis_push_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
