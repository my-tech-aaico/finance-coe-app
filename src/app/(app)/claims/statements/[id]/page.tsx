import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import {
  statement,
  statementVerificationAttempt,
  user as userTable,
} from "@/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import { VerificationStatusBadge } from "../_components/VerificationStatusBadge";
import { VerificationHistoryAccordion } from "../_components/VerificationHistoryAccordion";
import { DetailHeaderActions } from "../_components/DetailHeaderActions";
import { NoticeBanner } from "../_components/NoticeBanner";

export default async function StatementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { id } = await params;
  const sp = await searchParams;

  const stmt = await db.query.statement.findFirst({
    where: and(eq(statement.id, id), isNull(statement.deletedAt)),
    with: {
      claim: {
        with: { claimant: true },
      },
      uploadedByUser: true,
    },
  });
  if (!stmt) notFound();

  // Scoping (§5.1 OR rule).
  const isAdminOrFinance = actor.role === "admin" || actor.role === "finance";
  const canSee =
    isAdminOrFinance ||
    stmt.uploadedBy === actor.id ||
    stmt.claim.claimantId === actor.id;
  if (!canSee) notFound();

  // Edit permission (§5.1 — OR for Employees).
  const canEdit =
    isAdminOrFinance ||
    stmt.uploadedBy === actor.id ||
    stmt.claim.claimantId === actor.id;

  // Hard-delete permission (§5.1 — Admin/Finance only).
  const canDelete = isAdminOrFinance;

  // Load attempts with their triggering user's name.
  const attemptRows = await db
    .select({
      id: statementVerificationAttempt.id,
      status: statementVerificationAttempt.status,
      opusJobId: statementVerificationAttempt.opusJobId,
      opusResponse: statementVerificationAttempt.opusResponse,
      triggerSource: statementVerificationAttempt.triggerSource,
      createdAt: statementVerificationAttempt.createdAt,
      triggeredByName: userTable.name,
    })
    .from(statementVerificationAttempt)
    .leftJoin(userTable, eq(statementVerificationAttempt.triggeredBy, userTable.id))
    .where(eq(statementVerificationAttempt.statementId, stmt.id))
    .orderBy(desc(statementVerificationAttempt.createdAt));

  const driveFolderUrl = `https://drive.google.com/drive/folders/${stmt.claim.driveStatementsFolderId}`;

  return (
    <div className="animate-in">
      {sp.notice && <NoticeBanner notice={sp.notice} />}

      <Link
        href="/claims/statements"
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-4 transition-colors"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Statements
      </Link>

      <div style={{ maxWidth: 920 }}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xl font-bold text-surface-900 mb-1">Statement Details</h2>
              <p style={{ fontFamily: "monospace", fontSize: 13, color: "#1d4ed8" }}>{stmt.displayId}</p>
            </div>
            <VerificationStatusBadge status={stmt.verificationStatus} />
          </div>

          <DetailHeaderActions
            statementId={stmt.id}
            statementDisplayId={stmt.displayId}
            claimDisplayId={stmt.claim.displayId}
            verificationStatus={stmt.verificationStatus}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </div>

        {/* Overview card */}
        <div className="bg-white rounded-xl border border-surface-200 shadow-sm mb-8">
          <div className="px-6 py-4 border-b border-surface-100">
            <h3 className="text-sm font-semibold text-surface-900">Overview</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <DetailField label="Statement Date">
              {new Date(stmt.statementDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </DetailField>
            <DetailField label="Upload Date">
              {new Date(stmt.uploadDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </DetailField>
            <DetailField label="Linked Claim">
              <Link href={`/claims/receipts/${stmt.claim.id}`} className="hover:underline">
                <span style={{ fontFamily: "monospace", color: "#1d4ed8" }}>{stmt.claim.displayId}</span>
                <span className="text-surface-600"> — {stmt.claim.description}</span>
              </Link>
            </DetailField>
            <DetailField label="Claimant">
              {stmt.claim.claimant?.name ?? <span className="text-surface-400">Unassigned</span>}
            </DetailField>
            <DetailField label="Claim Description" full>
              {stmt.claim.description}
            </DetailField>
            <DetailField label="Statement File">
              <a
                href={stmt.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5"
                style={{ color: "#4263eb", fontWeight: 500 }}
              >
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {stmt.fileName}
              </a>
            </DetailField>
            <DetailField label="Google Drive Folder">
              <a
                href={driveFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5"
                style={{ color: "#4263eb", fontWeight: 500 }}
              >
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="15,3 21,3 21,9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Open in Google Drive
              </a>
            </DetailField>
          </div>
        </div>

        {/* Verification history */}
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-surface-900 mb-3">Verification History</h3>
        </div>
        <VerificationHistoryAccordion
          attempts={attemptRows.map((a) => ({
            ...a,
            createdAt: new Date(a.createdAt),
          }))}
          lastDestructiveEditAt={stmt.lastDestructiveEditAt}
        />
      </div>
    </div>
  );
}

function DetailField({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div
      className="px-6 py-4 border-b border-surface-100"
      style={{ gridColumn: full ? "1 / -1" : undefined }}
    >
      <p className="text-xs text-surface-400 mb-1">{label}</p>
      <div className="text-sm font-medium text-surface-800">{children}</div>
    </div>
  );
}
