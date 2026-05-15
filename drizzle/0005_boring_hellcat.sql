ALTER TABLE "claim" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "claim" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_deleted_at_partial_idx" ON "claim" USING btree ("deleted_at") WHERE deleted_at IS NULL;