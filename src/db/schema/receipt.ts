import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { claim } from "./claim";
import { department } from "./department";
import { class_ } from "./class";
import { projectCode } from "./projectCode";
import { teamSplit } from "./teamSplit";

// v2: receipts no longer capture a monetary amount — the amount/currency/USD/fx
// columns were dropped (moved to a separate system). Receipt now carries a
// Department, Class, Team Split (class-dependent, nullable) and Project Code.
export const receipt = pgTable("receipt", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  claimId: text("claim_id").notNull().references(() => claim.id),
  departmentId: text("department_id").notNull().references(() => department.id),
  classId: text("class_id").notNull().references(() => class_.id),
  // Nullable: a class may have no team splits; legacy rows have none.
  teamSplitId: text("team_split_id").references(() => teamSplit.id),
  // Nullable at DB (legacy rows have none); required at the app level for new
  // receipts. `projectCode` is a snapshot of the code string at write time — the
  // project_code list is externally synced and may rename/remove entries.
  projectCodeId: text("project_code_id").references(() => projectCode.id),
  projectCode: text("project_code"),
  driveFileId: text("drive_file_id").notNull(),
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name").notNull(),
  uploadedBy: text("uploaded_by").notNull().references(() => user.id),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("receipt_claim_id_idx").on(t.claimId),
  index("receipt_uploaded_by_idx").on(t.uploadedBy),
  index("receipt_uploaded_at_idx").on(t.uploadedAt),
  index("receipt_team_split_id_idx").on(t.teamSplitId),
  index("receipt_project_code_id_idx").on(t.projectCodeId),
]);
