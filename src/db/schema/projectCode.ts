import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Read-only in the portal: this list is maintained by an out-of-scope scheduled
// sync job. No status column (spec §9 — Code + Name only). Codes are UPPERCASE
// (e.g. "PRJ-100"), so — unlike class/department — there is no lowercase check.
export const projectCode = pgTable("project_code", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
