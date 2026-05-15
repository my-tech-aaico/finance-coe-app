import {
  pgTable,
  text,
  timestamp,
  smallint,
  bigint,
  pgEnum,
  pgSequence,
  check,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";
import { entity } from "./entity";

export const claimSeq = pgSequence("claim_seq", { startWith: 1, increment: 1 });

export const claimStatusEnum = pgEnum("claim_status", [
  "awaiting_statement",
  "statement_attached",
]);

export const claim = pgTable(
  "claim",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
    displayId: text("display_id").notNull(),
    claimMonth: smallint("claim_month").notNull(),
    claimYear: smallint("claim_year").notNull(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entity.id),
    description: text("description").notNull(),
    claimantId: text("claimant_id").references(() => user.id),
    status: claimStatusEnum("status").notNull().default("awaiting_statement"),
    driveFolderId: text("drive_folder_id").notNull(),
    driveReceiptsFolderId: text("drive_receipts_folder_id").notNull(),
    driveStatementsFolderId: text("drive_statements_folder_id").notNull(),
    driveNetsuiteFolderId: text("drive_netsuite_folder_id").notNull(),
    driveReceiptsUrl: text("drive_receipts_url").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by").references(() => user.id),
  },
  (t) => [
    unique("claim_sequence_number_unique").on(t.sequenceNumber),
    unique("claim_display_id_unique").on(t.displayId),
    index("claim_entity_id_idx").on(t.entityId),
    index("claim_status_idx").on(t.status),
    index("claim_created_at_idx").on(t.createdAt),
    index("claim_deleted_at_partial_idx").on(t.deletedAt).where(sql`deleted_at IS NULL`),
    check("claim_month_range", sql`${t.claimMonth} BETWEEN 1 AND 12`),
    check("claim_year_range", sql`${t.claimYear} BETWEEN 2020 AND 2100`),
  ]
);
