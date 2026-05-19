CREATE TYPE "public"."class_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."department_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "class" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "class_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "class_code_unique" UNIQUE("code"),
	CONSTRAINT "class_code_lowercase" CHECK ("class"."code" = lower("class"."code"))
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "department_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "department_code_unique" UNIQUE("code"),
	CONSTRAINT "department_code_lowercase" CHECK ("department"."code" = lower("department"."code"))
);
--> statement-breakpoint
CREATE TABLE "fx_rate" (
	"currency_pair" text PRIMARY KEY NOT NULL,
	"rate" numeric(15, 6) NOT NULL,
	"fetched_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"receipt_date" date NOT NULL,
	"amount_local" numeric(15, 2) NOT NULL,
	"currency_code" text NOT NULL,
	"amount_usd" numeric(15, 2) NOT NULL,
	"fx_rate" numeric(15, 6) NOT NULL,
	"fx_rate_fetched_at" timestamp NOT NULL,
	"department_id" text NOT NULL,
	"class_id" text NOT NULL,
	"drive_file_id" text NOT NULL,
	"file_url" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_amount_local_positive" CHECK ("receipt"."amount_local" > 0),
	CONSTRAINT "receipt_amount_usd_non_negative" CHECK ("receipt"."amount_usd" >= 0),
	CONSTRAINT "receipt_currency_code_format" CHECK ("receipt"."currency_code" = upper("receipt"."currency_code") AND length("receipt"."currency_code") = 3)
);
--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_status_idx" ON "class" USING btree ("status");--> statement-breakpoint
CREATE INDEX "department_status_idx" ON "department" USING btree ("status");--> statement-breakpoint
CREATE INDEX "receipt_claim_id_idx" ON "receipt" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "receipt_uploaded_by_idx" ON "receipt" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "receipt_date_idx" ON "receipt" USING btree ("receipt_date");