import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runVerificationSubmit } from "@/lib/verificationJobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await runVerificationSubmit();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[verification-submit] (HTTP) Fatal:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
