CREATE TYPE "public"."entity_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "entity" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_code_unique" UNIQUE("code"),
	CONSTRAINT "entity_code_lowercase" CHECK ("entity"."code" = lower("entity"."code"))
);
--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;