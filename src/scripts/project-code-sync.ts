import "dotenv/config";
import { runProjectCodeSync } from "@/lib/projectCodeSync";

// Standalone trigger for the Project Code sync (mirrors fx-scheduler.ts).
// The same logic is also exposed over HTTP at POST /api/cron/project-code-sync.
async function main() {
  const result = await runProjectCodeSync();
  // Explicit exit so the pg pool doesn't keep the event loop alive.
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[project-code-sync] Fatal:", err);
  process.exit(1);
});
