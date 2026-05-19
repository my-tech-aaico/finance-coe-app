import { NextRequest } from "next/server";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { receipt } from "@/db/schema";
import { eq } from "drizzle-orm";
import { downloadDriveFile } from "@/lib/drive";
import { resolveDetailViewMode } from "@/app/(app)/claims/receipts/[id]/_lib/access";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ receiptId: string }> }
) {
  let actor: Awaited<ReturnType<typeof requireRole>>;
  try {
    actor = await requireRole(["admin", "finance", "employee"]);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const { receiptId } = await params;

  const row = await db.query.receipt.findFirst({
    where: eq(receipt.id, receiptId),
    with: { claim: true },
  });

  if (!row || row.claim.deletedAt) {
    return new Response("Not found", { status: 404 });
  }

  const mode = await resolveDetailViewMode(actor, row.claim);
  if (mode === "employee_other" && row.uploadedBy !== actor.id) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const { stream, mimeType } = await downloadDriveFile(row.driveFileId);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${row.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error(`[receipt file] Drive fetch failed for receipt ${receiptId}:`, err);
    return new Response("Could not retrieve file", { status: 500 });
  }
}
