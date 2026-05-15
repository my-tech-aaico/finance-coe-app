import { pgTable, text, timestamp, pgEnum, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

export const entityStatusEnum = pgEnum("entity_status", ["active", "inactive"]);

export const entity = pgTable("entity", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  status: entityStatusEnum("status").notNull().default("active"),
  createdBy: text("created_by").references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  check("entity_code_lowercase", sql`${t.code} = lower(${t.code})`),
  index("entity_status_idx").on(t.status),
]);
