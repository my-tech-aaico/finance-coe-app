import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function reserveNextSequence(): Promise<number> {
  const result = await db.execute(sql`SELECT nextval('claim_seq')::int AS seq`);
  return Number((result as any).rows?.[0]?.seq ?? (result as any)[0]?.seq);
}
