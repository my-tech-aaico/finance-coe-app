import "dotenv/config";
import { db } from "@/db";
import { entity, fxRate } from "@/db/schema";
import { eq } from "drizzle-orm";

const PROVIDER_BASE = process.env.FX_PROVIDER_URL ?? "https://open.er-api.com/v6/latest";
const TARGET = process.env.FX_TARGET_CURRENCY ?? "USD";

async function fetchRate(fromCurrency: string): Promise<number | null> {
  const url = `${PROVIDER_BASE}/${fromCurrency}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      console.error(`[fx-scheduler] HTTP ${resp.status} for ${fromCurrency}: ${await resp.text()}`);
      return null;
    }
    const data = await resp.json();
    if (data.result !== "success" || typeof data.rates?.[TARGET] !== "number") {
      console.error(`[fx-scheduler] Unexpected response shape for ${fromCurrency}:`, data);
      return null;
    }
    return data.rates[TARGET];
  } catch (err) {
    console.error(`[fx-scheduler] Network error for ${fromCurrency}:`, err);
    return null;
  }
}

async function main() {
  const start = Date.now();
  const pairs = await db.selectDistinct({ currency: entity.currency })
    .from(entity)
    .where(eq(entity.status, "active"));

  let successCount = 0;
  let failCount = 0;

  for (const { currency } of pairs) {
    if (currency === TARGET) continue;

    const rate = await fetchRate(currency);
    if (rate === null) {
      failCount++;
      continue;
    }

    const currencyPair = `${currency}-${TARGET}`;
    await db.insert(fxRate)
      .values({ currencyPair, rate: String(rate), fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: fxRate.currencyPair,
        set: { rate: String(rate), fetchedAt: new Date() },
      });
    successCount++;
  }

  const elapsedMs = Date.now() - start;
  console.log(`[fx-scheduler] Done in ${elapsedMs}ms. Success: ${successCount}, Failed: ${failCount}.`);

  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[fx-scheduler] Fatal:", err);
  process.exit(1);
});
