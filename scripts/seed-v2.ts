import "dotenv/config";
import { db } from "../src/db";
import { projectCode, teamSplit, class_ as klass } from "../src/db/schema";
import { and, eq } from "drizzle-orm";

// Idempotent seed for v2: project codes (incl. a default) + sample team splits.
// The real Project Code list is populated by an out-of-scope sync job; this just
// guarantees the receipt form is usable before that job runs.

const PROJECT_CODES: { code: string; name: string; status?: "active" | "inactive" }[] = [
  { code: "PRJ-000", name: "Default / Unassigned" }, // default fallback row
  { code: "PRJ-100", name: "Platform Modernisation" },
  { code: "PRJ-205", name: "Client Onboarding APAC" },
  { code: "PRJ-311", name: "Data Warehouse Migration", status: "inactive" }, // inactive for test coverage of active-only dropdown + edit-with-inactive-code
  { code: "PRJ-402", name: "Mobile App Revamp" },
];

// Team splits keyed by class CODE. Classes not listed here (e.g. meals, training)
// intentionally have no splits, so the "optional" path is exercised.
const TEAM_SPLITS: Record<string, { code: string; name: string; status?: "active" | "inactive" }[]> = {
  travel: [
    { code: "team-a", name: "Team A" },
    { code: "team-b", name: "Team B", status: "inactive" }, // inactive for test coverage of edit-with-inactive-split
  ],
  office: [{ code: "ops", name: "Operations Split" }],
  software: [
    { code: "team-eng", name: "Engineering Split" },
    { code: "team-data", name: "Data Split" },
  ],
};

async function seed() {
  // Project codes
  for (const pc of PROJECT_CODES) {
    const existing = await db.query.projectCode.findFirst({ where: eq(projectCode.code, pc.code) });
    if (existing) {
      console.log(`Skip project code: ${pc.code} already exists.`);
      continue;
    }
    await db.insert(projectCode).values({ code: pc.code, name: pc.name, status: pc.status ?? "active" });
    console.log(`Seeded project code: ${pc.code} — ${pc.name}${pc.status === "inactive" ? " (inactive)" : ""}`);
  }

  // Team splits (require the parent class to exist)
  for (const [classCode, splits] of Object.entries(TEAM_SPLITS)) {
    const cls = await db.query.class_.findFirst({ where: eq(klass.code, classCode) });
    if (!cls) {
      console.log(`Skip team splits for class "${classCode}": class not found.`);
      continue;
    }
    for (const s of splits) {
      const existing = await db.query.teamSplit.findFirst({
        where: and(eq(teamSplit.classId, cls.id), eq(teamSplit.code, s.code)),
      });
      if (existing) {
        console.log(`Skip team split: ${classCode}/${s.code} already exists.`);
        continue;
      }
      await db.insert(teamSplit).values({ code: s.code, name: s.name, classId: cls.id, status: s.status ?? "active" });
      console.log(`Seeded team split: ${classCode}/${s.code} — ${s.name}`);
    }
  }

  // Ensure travel/team-b is inactive (may already exist from a prior seed run).
  const travelCls = await db.query.class_.findFirst({ where: eq(klass.code, "travel") });
  if (travelCls) {
    await db
      .update(teamSplit)
      .set({ status: "inactive" })
      .where(and(eq(teamSplit.classId, travelCls.id), eq(teamSplit.code, "team-b")));
    console.log("Set travel/team-b to inactive (test coverage).");
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error("v2 seed failed:", err);
  process.exit(1);
});
