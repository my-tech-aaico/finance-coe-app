import { pgTable, text, timestamp, pgEnum, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

export const departmentStatusEnum = pgEnum("department_status", ["active", "inactive"]);

export const department = pgTable("department", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  status: departmentStatusEnum("status").notNull().default("active"),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  check("department_code_lowercase", sql`${t.code} = lower(${t.code})`),
  index("department_status_idx").on(t.status),
]);
