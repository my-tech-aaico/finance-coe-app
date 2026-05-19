import { pgTable, text, timestamp, numeric, date, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { claim } from "./claim";
import { department } from "./department";
import { class_ } from "./class";

export const receipt = pgTable("receipt", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  claimId: text("claim_id").notNull().references(() => claim.id),
  receiptDate: date("receipt_date").notNull(),
  amountLocal: numeric("amount_local", { precision: 15, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull(),
  amountUsd: numeric("amount_usd", { precision: 15, scale: 2 }).notNull(),
  fxRate: numeric("fx_rate", { precision: 15, scale: 6 }).notNull(),
  fxRateFetchedAt: timestamp("fx_rate_fetched_at").notNull(),
  departmentId: text("department_id").notNull().references(() => department.id),
  classId: text("class_id").notNull().references(() => class_.id),
  driveFileId: text("drive_file_id").notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  uploadedBy: text("uploaded_by").notNull().references(() => user.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  check("receipt_amount_local_positive", sql`${t.amountLocal} > 0`),
  check("receipt_amount_usd_non_negative", sql`${t.amountUsd} >= 0`),
  check("receipt_currency_code_format", sql`${t.currencyCode} = upper(${t.currencyCode}) AND length(${t.currencyCode}) = 3`),
  index("receipt_claim_id_idx").on(t.claimId),
  index("receipt_uploaded_by_idx").on(t.uploadedBy),
  index("receipt_date_idx").on(t.receiptDate),
]);
