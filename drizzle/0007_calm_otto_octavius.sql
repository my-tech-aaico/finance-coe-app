CREATE TYPE "public"."statement_verification_status" AS ENUM('pending_verification', 'queued', 'in_progress', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."statement_verification_attempt_status" AS ENUM('queued', 'in_progress', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."statement_verification_trigger_source" AS ENUM('upload_checkbox', 'manual_start', 'manual_retry', 'scheduler');--> statement-breakpoint
CREATE SEQUENCE "public"."statement_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "statement" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_number" bigint NOT NULL,
	"display_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"statement_date" date NOT NULL,
	"upload_date" timestamp DEFAULT now() NOT NULL,
	"drive_file_id" text NOT NULL,
	"file_url" text NOT NULL,
	"file_name" text NOT NULL,
	"file_mime_type" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"verification_status" "statement_verification_status" DEFAULT 'pending_verification' NOT NULL,
	"last_destructive_edit_at" timestamp,
	"uploaded_by" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" text,
	CONSTRAINT "statement_sequence_number_unique" UNIQUE("sequence_number"),
	CONSTRAINT "statement_display_id_unique" UNIQUE("display_id"),
	CONSTRAINT "statement_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
CREATE TABLE "statement_verification_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL,
	"status" "statement_verification_attempt_status" NOT NULL,
	"opus_job_id" text,
	"opus_response" jsonb,
	"triggered_by" text,
	"trigger_source" "statement_verification_trigger_source" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_verification_attempt" ADD CONSTRAINT "statement_verification_attempt_statement_id_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_verification_attempt" ADD CONSTRAINT "statement_verification_attempt_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statement_verification_status_idx" ON "statement" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "statement_statement_date_idx" ON "statement" USING btree ("statement_date");--> statement-breakpoint
CREATE INDEX "statement_upload_date_idx" ON "statement" USING btree ("upload_date");--> statement-breakpoint
CREATE INDEX "statement_verification_attempt_statement_id_idx" ON "statement_verification_attempt" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "statement_verification_attempt_statement_created_idx" ON "statement_verification_attempt" USING btree ("statement_id","created_at");--> statement-breakpoint
CREATE INDEX "statement_verification_attempt_status_idx" ON "statement_verification_attempt" USING btree ("status");