import Link from "next/link";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, user } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { UploadStatementForm } from "./UploadStatementForm";

export default async function NewStatementPage() {
  await requireRole(["admin", "finance", "credit_card_holder"]);

  // v2 eligible claims:
  //   - status = 'awaiting_statement'
  //   - deletedAt IS NULL
  // A claimant is NOT required, and CCH/Finance/Admin see all such claims (spec §6.1).
  const conditions = [
    eq(claim.status, "awaiting_statement"),
    isNull(claim.deletedAt),
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const claims = await db
    .select({
      id: claim.id,
      displayId: claim.displayId,
      description: claim.description,
      claimantName: user.name,
    })
    .from(claim)
    .leftJoin(user, eq(claim.claimantId, user.id))
    .where(and(...conditions))
    .orderBy(sql`${claim.displayId} ASC`);

  if (claims.length === 0) {
    return (
      <div className="animate-in">
        <Link
          href="/claims/statements"
          className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-6 transition-colors"
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Statements
        </Link>

        <div className="bg-white rounded-xl border border-surface-200 shadow-sm">
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-14 h-14 rounded-full bg-brand-50 flex items-center justify-center mb-4">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="#4263eb" strokeWidth="1.8" strokeLinecap="round" />
                <polyline points="17,8 12,3 7,8" stroke="#91a7ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="3" x2="12" y2="15" stroke="#91a7ff" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-surface-900 font-semibold mb-1">
              No claims awaiting a statement
            </p>
            <p className="text-sm text-surface-400 mb-5" style={{ maxWidth: 380 }}>
              There are no claims with “Awaiting Statement” status. Create a new claim (or ask Finance to) before uploading a statement.
            </p>
            <div className="flex items-center gap-3">
              <Link href="/claims/statements" className="btn-secondary">
                Back to Statements
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <UploadStatementForm claims={claims} />;
}
