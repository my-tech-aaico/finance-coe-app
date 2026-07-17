import "dotenv/config";
import { runVerificationPoll } from "@/lib/verificationJobs";

const LOG = "[verification-poll]";

async function main() {
  await runVerificationPoll();
  // src/db/index.ts opens a pg.Pool at module load whose connections keep the
  // Node event loop alive until they idle out — exit explicitly rather than
  // letting main() merely return.
  process.exit(0);
}

main().catch((err) => {
  console.error(`${LOG} Fatal:`, err);
  process.exit(1);
});
