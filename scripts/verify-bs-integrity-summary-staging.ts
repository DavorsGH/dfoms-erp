/**
 * Verify balance-sheet-integrity summary card data on staging.
 * Usage: npx tsx scripts/verify-bs-integrity-summary-staging.ts --env-file .env.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { BS_INTEGRITY_EVENT_NAME } from "../utils/balance-sheet-integrity-constants";

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  let envFile = ".env.local";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--env-file=")) envFile = arg.slice("--env-file=".length);
  }
  loadEnv(resolve(envFile));

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await admin
    .from("system_event_log")
    .select("status, message, metadata, created_at")
    .eq("event_name", BS_INTEGRITY_EVENT_NAME)
    .order("created_at", { ascending: false })
    .limit(250);

  if (error) throw error;

  const latestByTenant = new Map<string, {
    tenantName: string;
    status: string;
    maxAbsDiff: number;
    imbalanceCount: number;
  }>();

  for (const row of data ?? []) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (metadata.kind === "run-summary") continue;
    const tenantId = metadata.tenantId as string | undefined;
    if (!tenantId || latestByTenant.has(tenantId)) continue;
    if (row.status !== "failure" && row.status !== "warning") continue;
    latestByTenant.set(tenantId, {
      tenantName: (metadata.tenantName as string) ?? tenantId,
      status: row.status,
      maxAbsDiff: Number(metadata.maxAbsDiff ?? 0),
      imbalanceCount: Array.isArray(metadata.imbalances)
        ? metadata.imbalances.length
        : 0,
    });
  }

  const summary = Array.from(latestByTenant.values()).sort((a, b) =>
    a.tenantName.localeCompare(b.tenantName),
  );

  console.log("\n=== Summary card data (staging) ===\n");
  if (summary.length === 0) {
    console.log("No tenants flagged — card should show green all-clear.");
    return;
  }

  for (const row of summary) {
    console.log(
      `${row.tenantName.padEnd(28)} ${row.status.padEnd(8)} maxAbs=${row.maxAbsDiff.toFixed(2)} months=${row.imbalanceCount}`,
    );
  }

  const caanta = summary.find((r) => r.tenantName.includes("Caanta"));
  if (!caanta) {
    console.error("\nFAIL: Caanta Market not in summary — expected flagged.");
    process.exit(1);
  }
  if (caanta.status !== "failure") {
    console.error(`\nFAIL: Caanta status is ${caanta.status}, expected failure.`);
    process.exit(1);
  }
  console.log("\nPASS: Caanta Market flagged as failure.");
  console.log(`PASS: ${summary.length} tenant(s) flagged (others on staging are clear).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
