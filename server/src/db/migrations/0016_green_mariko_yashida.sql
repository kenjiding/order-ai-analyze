CREATE TABLE "vendor_daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_date" varchar(10) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_code" varchar(64) NOT NULL,
	"vendor_name" varchar(255) NOT NULL,
	"token" varchar(128) NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vendor_daily_reports" ADD CONSTRAINT "vendor_daily_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_share_links" ADD CONSTRAINT "vendor_share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_daily_reports_created_at_idx" ON "vendor_daily_reports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_share_links_vendor_code_unique" ON "vendor_share_links" USING btree ("vendor_code");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_share_links_token_unique" ON "vendor_share_links" USING btree ("token");