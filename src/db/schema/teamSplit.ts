import { pgTable, text, timestamp, check, index, unique, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { class_ } from "./class";

export const teamSplitStatus = pgEnum("team_split_status", ["active", "inactive"]);

// A Team Split belongs to exactly one Class and has its own status column (spec §12).
// Codes are lowercase and unique WITHIN a class.
export const teamSplit = pgTable(
  "team_split",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    code: text("code").notNull(),
    name: text("name").notNull(),
    classId: text("class_id")
      .notNull()
      .references(() => class_.id),
    status: teamSplitStatus("status").notNull().default("active"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("team_split_class_code_unique").on(t.classId, t.code),
    index("team_split_class_id_idx").on(t.classId),
    check("team_split_code_lowercase", sql`${t.code} = lower(${t.code})`),
  ]
);
