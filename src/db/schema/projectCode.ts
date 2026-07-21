import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const projectCodeStatus = pgEnum("project_code_status", ["active", "inactive"]);

// List is populated/kept in sync by a Google-Sheet sync job (guidelines/spec/project-code.md §15),
// but status is toggled manually in the portal — the sync never deactivates a code.
// Codes are UPPERCASE (e.g. "PRJ-100"), so — unlike class/department — there is no lowercase check.
export const projectCode = pgTable("project_code", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  status: projectCodeStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
