import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runProjectCodeSync } from "@/lib/projectCodeSync";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await runProjectCodeSync();
    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      renamed: result.renamed,
      unchanged: result.unchanged,
      skipped: result.skipped,
      duplicates: result.duplicates,
      totalSheetRows: result.totalSheetRows,
      ms: result.ms,
    });
  } catch (err) {
    console.error("[project-code-sync] (HTTP) Fatal:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
