import {
  pgTable,
  text,
  timestamp,
  bigint,
  date,
  pgEnum,
  pgSequence,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { claim } from "./claim";

export const statementSeq = pgSequence("statement_seq", {
  startWith: 1,
  increment: 1,
});

export const statementVerificationStatusEnum = pgEnum(
  "statement_verification_status",
  ["pending_verification", "queued", "in_progress", "success", "failed"]
);

export const statement = pgTable(
  "statement",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
    displayId: text("display_id").notNull(),
    claimId: text("claim_id")
      .notNull()
      .references(() => claim.id),
    statementDate: date("statement_date").notNull(),
    uploadDate: timestamp("upload_date").notNull().defaultNow(),
    driveFileId: text("drive_file_id").notNull(),
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name").notNull(),
    fileMimeType: text("file_mime_type").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    verificationStatus: statementVerificationStatusEnum("verification_status")
      .notNull()
      .default("pending_verification"),
    lastDestructiveEditAt: timestamp("last_destructive_edit_at"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by").references(() => user.id),
  },
  (t) => [
    unique("statement_sequence_number_unique").on(t.sequenceNumber),
    unique("statement_display_id_unique").on(t.displayId),
    unique("statement_claim_id_unique").on(t.claimId),
    index("statement_verification_status_idx").on(t.verificationStatus),
    index("statement_statement_date_idx").on(t.statementDate),
    index("statement_upload_date_idx").on(t.uploadDate),
  ]
);
