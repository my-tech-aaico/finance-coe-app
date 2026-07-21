CREATE TYPE "public"."project_code_status" AS ENUM('active', 'inactive');--> statement-breakpoint
ALTER TABLE "project_code" ADD COLUMN "status" "project_code_status" DEFAULT 'active' NOT NULL;
