import {
  pgTable,
  text,
  timestamp,
  jsonb,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { statement } from "./statement";

export const statementVerificationAttemptStatusEnum = pgEnum(
  "statement_verification_attempt_status",
  ["queued", "in_progress", "success", "failed"]
);

export const statementVerificationTriggerSourceEnum = pgEnum(
  "statement_verification_trigger_source",
  ["upload_checkbox", "manual_start", "manual_retry", "scheduler"]
);

export const statementVerificationAttempt = pgTable(
  "statement_verification_attempt",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    statementId: text("statement_id")
      .notNull()
      .references(() => statement.id, { onDelete: "cascade" }),
    status: statementVerificationAttemptStatusEnum("status").notNull(),
    opusJobId: text("opus_job_id"),
    opusResponse: jsonb("opus_response"),
    remarks: text("remarks"),
    triggeredBy: text("triggered_by").references(() => user.id),
    triggerSource:
      statementVerificationTriggerSourceEnum("trigger_source").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("statement_verification_attempt_statement_id_idx").on(t.statementId),
    index("statement_verification_attempt_statement_created_idx").on(
      t.statementId,
      t.createdAt
    ),
    index("statement_verification_attempt_status_idx").on(t.status),
  ]
);
