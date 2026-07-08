// Server-only DB helpers shared by the verification scheduler scripts.
// The denormalization invariant (scheduler.md §2.1) — keep statement.verificationStatus
// in sync with the latest attempt — lives here in exactly one place.
//
// NOT a "use server" file and imports no Next.js APIs, so the standalone tsx
// scheduler scripts can import it. Do not reuse the portal's
// transitionVerificationStatus (it INSERTs a new attempt and lives in a "use server"
// file); finalizeAttempt mutates the existing row in place.

import { db } from "@/db";
import { statement, statementVerificationAttempt } from "@/db/schema";
import { eq } from "drizzle-orm";

type Terminal = "success" | "failed";

/** Apply a terminal outcome to an attempt AND mirror it onto the parent statement, atomically. */
export async function finalizeAttempt(input: {
  attemptId: string;
  statementId: string;
  status: Terminal;
  opusResponse?: unknown;
  remarks: string | null;
}): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(statementVerificationAttempt)
      .set({
        status: input.status,
        opusResponse: input.opusResponse ?? null,
        remarks: input.remarks,
        updatedAt: now,
      })
      .where(eq(statementVerificationAttempt.id, input.attemptId));

    await tx
      .update(statement)
      .set({ verificationStatus: input.status, updatedAt: now })
      .where(eq(statement.id, input.statementId));
  });
}
