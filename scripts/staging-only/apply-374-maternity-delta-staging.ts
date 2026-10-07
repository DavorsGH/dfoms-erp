/**
 * Re-apply script 374 maternity delta (policy, resolve_leave_entitlement, leave submit overlap).
 * Safe to run after initial PART2 apply.
 *
 * npx tsx scripts/staging-only/apply-374-maternity-delta-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "../lib/pg-connect";

const SQL_PATH = resolve(process.cwd(), "scripts/374_salary_advance_payroll_lock.sql");

async function main() {
  const full = readFileSync(SQL_PATH, "utf8");
  const start = full.indexOf("ALTER TABLE public.leave_entitlement_policy");
  const end = full.indexOf("COMMIT;", start);
  if (start < 0 || end < 0) {
    throw new Error("Could not extract maternity delta from 374");
  }
  const delta = `${full.slice(start, end)}\n`;

  const { client } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local", ".env.local"],
  });
  try {
    await client.query("BEGIN");
    await client.query(delta);
    await client.query("COMMIT");
    console.log("374 maternity delta applied on staging.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
