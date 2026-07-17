-- Add own status column to team_split (spec §12 redesign).
-- Team splits now have independent status from their parent class.

CREATE TYPE "public"."team_split_status" AS ENUM('active', 'inactive');--> statement-breakpoint
ALTER TABLE "team_split" ADD COLUMN "status" "team_split_status" DEFAULT 'active' NOT NULL;
