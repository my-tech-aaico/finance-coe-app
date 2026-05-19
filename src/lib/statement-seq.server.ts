import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function reserveNextStatementSequence(): Promise<number> {
  const result = await db.execute(
    // language=PostgreSQL
    sql`SELECT nextval('statement_seq')::int AS seq`
  );
  // pg driver returns { rows: [...] }; postgres-js returns the array directly.
  // Match the receipts pattern from claim-seq.server.ts.
  return Number(
    (result as unknown as { rows?: { seq: number }[] }).rows?.[0]?.seq ??
      (result as unknown as { seq: number }[])[0]?.seq
  );
}
