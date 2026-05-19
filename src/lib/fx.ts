import { db } from "@/db";
import { fxRate } from "@/db/schema";
import { eq } from "drizzle-orm";

const TARGET = process.env.FX_TARGET_CURRENCY ?? "USD";

export async function getCurrentRate(fromCurrency: string): Promise<{ rate: number; fetchedAt: Date }> {
  if (fromCurrency === TARGET) {
    return { rate: 1, fetchedAt: new Date() };
  }

  const currencyPair = `${fromCurrency}-${TARGET}`;
  const row = await db.query.fxRate.findFirst({ where: eq(fxRate.currencyPair, currencyPair) });

  if (!row) {
    throw new Error(
      `No FX rate available for ${currencyPair}. The scheduler may not have run yet for this currency. ` +
      `If this is a newly added entity currency, wait up to one hour for the next scheduler tick.`
    );
  }

  return { rate: Number(row.rate), fetchedAt: row.fetchedAt };
}
