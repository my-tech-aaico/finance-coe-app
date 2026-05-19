import { pgTable, text, timestamp, numeric } from "drizzle-orm/pg-core";

export const fxRate = pgTable("fx_rate", {
  currencyPair: text("currency_pair").primaryKey(),
  rate: numeric("rate", { precision: 15, scale: 6 }).notNull(),
  fetchedAt: timestamp("fetched_at").notNull(),
});
