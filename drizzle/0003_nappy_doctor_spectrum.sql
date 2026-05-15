CREATE TYPE "public"."claim_status" AS ENUM('awaiting_statement', 'statement_attached');--> statement-breakpoint
CREATE SEQUENCE "public"."claim_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "claim" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_number" integer NOT NULL,
	"display_id" text NOT NULL,
	"claim_month" smallint NOT NULL,
	"claim_year" smallint NOT NULL,
	"entity_id" text NOT NULL,
	"description" text NOT NULL,
	"claimant_id" text,
	"status" "claim_status" DEFAULT 'awaiting_statement' NOT NULL,
	"drive_folder_id" text NOT NULL,
	"drive_receipts_folder_id" text NOT NULL,
	"drive_statements_folder_id" text NOT NULL,
	"drive_netsuite_folder_id" text NOT NULL,
	"drive_receipts_url" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "claim_sequence_number_unique" UNIQUE("sequence_number"),
	CONSTRAINT "claim_display_id_unique" UNIQUE("display_id"),
	CONSTRAINT "claim_month_range" CHECK ("claim"."claim_month" BETWEEN 1 AND 12),
	CONSTRAINT "claim_year_range" CHECK ("claim"."claim_year" BETWEEN 2020 AND 2100)
);
--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_claimant_id_user_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_entity_id_idx" ON "claim" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "claim_status_idx" ON "claim" USING btree ("status");--> statement-breakpoint
CREATE INDEX "claim_created_at_idx" ON "claim" USING btree ("created_at");