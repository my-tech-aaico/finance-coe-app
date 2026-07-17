-- v2 migration — hand-written incremental (drizzle/meta is gitignored here).
-- Covers: Credit Card Holder role, Project Code + Team Split tables,
-- receipt reshape (add project_code/team_split, drop amount/FX/date columns).
--
-- ⚠️ DESTRUCTIVE: step 5 drops the receipt amount/currency/USD/fx/receipt_date
--    columns. Back these up first, e.g.:
--      pg_dump "$DATABASE_URL" -t receipt --data-only > backup_receipt.sql
--
-- Apply with psql (each statement autocommits) after the backup:
--      psql "$DATABASE_URL" -f drizzle/0009_v2_project_code_team_split.sql
--
-- Enum note: ALTER TYPE ... ADD VALUE must NOT run inside an explicit transaction
-- on Postgres < 12. Run via psql (autocommit) — do not wrap this file in BEGIN/COMMIT.

-- 1) New role value.
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'credit_card_holder';--> statement-breakpoint

-- 2) Project Code (read-only list, populated by an out-of-scope sync job).
CREATE TABLE IF NOT EXISTS "project_code" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_code_code_unique" UNIQUE("code")
);
--> statement-breakpoint

-- 3) Team Split (belongs to exactly one Class; status inherited from the Class).
CREATE TABLE IF NOT EXISTS "team_split" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"class_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_split_class_code_unique" UNIQUE("class_id","code"),
	CONSTRAINT "team_split_code_lowercase" CHECK ("team_split"."code" = lower("team_split"."code"))
);
--> statement-breakpoint
ALTER TABLE "team_split" ADD CONSTRAINT "team_split_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_split" ADD CONSTRAINT "team_split_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_split" ADD CONSTRAINT "team_split_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_split_class_id_idx" ON "team_split" USING btree ("class_id");--> statement-breakpoint

-- 4) Receipt: add the new (nullable) columns, FKs and indexes.
ALTER TABLE "receipt" ADD COLUMN IF NOT EXISTS "team_split_id" text;--> statement-breakpoint
ALTER TABLE "receipt" ADD COLUMN IF NOT EXISTS "project_code_id" text;--> statement-breakpoint
ALTER TABLE "receipt" ADD COLUMN IF NOT EXISTS "project_code" text;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_team_split_id_team_split_id_fk" FOREIGN KEY ("team_split_id") REFERENCES "public"."team_split"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_project_code_id_project_code_id_fk" FOREIGN KEY ("project_code_id") REFERENCES "public"."project_code"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_uploaded_at_idx" ON "receipt" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_team_split_id_idx" ON "receipt" USING btree ("team_split_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_project_code_id_idx" ON "receipt" USING btree ("project_code_id");--> statement-breakpoint

-- 5) Receipt: drop amount/FX/date columns + their checks + the receipt_date index.
--    ⚠️ DESTRUCTIVE — discards historical amount/FX values. Back up first (see header).
DROP INDEX IF EXISTS "receipt_date_idx";--> statement-breakpoint
ALTER TABLE "receipt" DROP CONSTRAINT IF EXISTS "receipt_amount_local_positive";--> statement-breakpoint
ALTER TABLE "receipt" DROP CONSTRAINT IF EXISTS "receipt_amount_usd_non_negative";--> statement-breakpoint
ALTER TABLE "receipt" DROP CONSTRAINT IF EXISTS "receipt_currency_code_format";--> statement-breakpoint
ALTER TABLE "receipt" DROP COLUMN IF EXISTS "receipt_date";--> statement-breakpoint
ALTER TABLE "receipt" DROP COLUMN IF EXISTS "amount_local";--> statement-breakpoint
ALTER TABLE "receipt" DROP COLUMN IF EXISTS "currency_code";--> statement-breakpoint
ALTER TABLE "receipt" DROP COLUMN IF EXISTS "amount_usd";--> statement-breakpoint
ALTER TABLE "receipt" DROP COLUMN IF EXISTS "fx_rate";--> statement-breakpoint
ALTER TABLE "receipt" DROP COLUMN IF EXISTS "fx_rate_fetched_at";
