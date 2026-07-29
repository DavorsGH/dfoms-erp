/**
 * On-demand leave balance resync from CURRENT Leave Entitlement Policy.
 *
 * For each employee_leave_balances row in the target year:
 *   new_entitled = resolveLeaveEntitlement(policy, position, employment_type, leave_type)
 *   remaining is generated as entitled_days - days_used (never touch days_used)
 *
 * Usage:
 *   npx tsx scripts/resync-leave-balances-from-policy.ts --env-file .env.staging.local
 *   npx tsx scripts/resync-leave-balances-from-policy.ts --env-file .env.staging.local --apply --confirm-decreases
 *   npx tsx scripts/resync-leave-balances-from-policy.ts --env-file .env.local.backup --dry-run --allow-production
 *
 * Safety:
 *   - Default is dry-run (no writes).
 *   - If any entitlement would DECREASE or remaining would go negative,
 *     --apply is blocked unless --confirm-decreases is also passed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  resolveLeaveEntitlement,
  type LeaveEntitlementPolicyRow,
} from "../app/dashboard/administration/leave-entitlement-policy-utils";

const STAGING = "wieflwbfdmjtsdnwbfii";
const PRODUCTION = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseArgs(argv: string[]) {
  let envFile = ".env.staging.local";
  let year = new Date().getFullYear();
  let tenantId = DAVORS;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--env-file") envFile = argv[++i] ?? envFile;
    else if (argv[i] === "--year") year = Number(argv[++i] ?? year);
    else if (argv[i] === "--tenant") tenantId = argv[++i] ?? tenantId;
  }
  return {
    envFile,
    year,
    tenantId,
    apply: argv.includes("--apply"),
    allowProduction: argv.includes("--allow-production"),
    confirmDecreases: argv.includes("--confirm-decreases"),
    dryRun: !argv.includes("--apply"),
  };
}

type BalanceRow = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  entitled_days: number;
  days_used: number;
  days_remaining: number | null;
};

type Plan = {
  balance: BalanceRow;
  staffId: string;
  fullName: string;
  leaveTypeName: string;
  position: string | null;
  employmentType: string | null;
  oldEntitled: number;
  newEntitled: number;
  daysUsed: number;
  oldRemaining: number;
  newRemaining: number;
  decreased: boolean;
  negativeRemaining: boolean;
  changed: boolean;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(process.cwd(), args.envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ref = new URL(url).hostname.split(".")[0];
  if (ref === PRODUCTION && !args.allowProduction) {
    throw new Error("Production requires --allow-production");
  }
  if (ref !== STAGING && ref !== PRODUCTION) {
    throw new Error(`Unexpected project ref ${ref}`);
  }
  if (!key) throw new Error("missing service role");
  if (!Number.isFinite(args.year) || args.year < 2000) {
    throw new Error(`Invalid --year ${args.year}`);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(
    `=== Leave balance resync | ref=${ref} | tenant=${args.tenantId} | year=${args.year} | mode=${args.apply ? "APPLY" : "DRY-RUN"} ===\n`,
  );

  const [
    { data: balances, error: balError },
    { data: employees, error: empError },
    { data: leaveTypes, error: ltError },
    { data: policies, error: polError },
  ] = await Promise.all([
    admin
      .from("employee_leave_balances")
      .select(
        "id, employee_id, leave_type_id, year, entitled_days, days_used, days_remaining",
      )
      .eq("tenant_id", args.tenantId)
      .eq("year", args.year),
    admin
      .from("employees")
      .select("employee_id, staff_id, full_name, position, employment_type")
      .eq("tenant_id", args.tenantId),
    admin.from("leave_types").select("id, type_name"),
    admin
      .from("leave_entitlement_policy")
      .select("id, tenant_id, position, employment_type, leave_type, entitled_days")
      .eq("tenant_id", args.tenantId),
  ]);

  if (balError) throw new Error(balError.message);
  if (empError) throw new Error(empError.message);
  if (ltError) throw new Error(ltError.message);
  if (polError) throw new Error(polError.message);

  const employeeById = new Map(
    (employees ?? []).map((e) => [e.employee_id, e]),
  );
  const leaveTypeById = new Map((leaveTypes ?? []).map((t) => [t.id, t]));
  const policyRows = (policies as LeaveEntitlementPolicyRow[] | null) ?? [];

  const plans: Plan[] = [];
  for (const balance of (balances as BalanceRow[] | null) ?? []) {
    const employee = employeeById.get(balance.employee_id);
    const leaveType = leaveTypeById.get(balance.leave_type_id);
    if (!employee || !leaveType) {
      console.warn(
        `SKIP balance ${balance.id}: missing employee or leave type`,
      );
      continue;
    }

    const oldEntitled = r2(balance.entitled_days);
    const daysUsed = r2(balance.days_used);
    const oldRemaining = r2(
      balance.days_remaining ?? oldEntitled - daysUsed,
    );
    const newEntitled = r2(
      resolveLeaveEntitlement(
        policyRows,
        employee.position,
        employee.employment_type,
        leaveType.type_name,
      ),
    );
    const newRemaining = r2(newEntitled - daysUsed);

    plans.push({
      balance,
      staffId: employee.staff_id,
      fullName: employee.full_name,
      leaveTypeName: leaveType.type_name,
      position: employee.position,
      employmentType: employee.employment_type,
      oldEntitled,
      newEntitled,
      daysUsed,
      oldRemaining,
      newRemaining,
      decreased: newEntitled + 0.005 < oldEntitled,
      negativeRemaining: newRemaining < -0.005,
      changed: Math.abs(newEntitled - oldEntitled) > 0.005,
    });
  }

  const changed = plans.filter((p) => p.changed);
  const decreases = plans.filter((p) => p.decreased);
  const negatives = plans.filter((p) => p.negativeRemaining);

  console.log(
    "staff_id".padEnd(12) +
      "leave".padEnd(16) +
      "entitled".padStart(10) +
      " →" +
      "entitled".padStart(10) +
      "remaining".padStart(10) +
      " →" +
      "remaining".padStart(10) +
      "  used".padStart(8) +
      "  flags",
  );

  for (const plan of plans) {
    if (!plan.changed && !plan.negativeRemaining) continue;
    const flags = [
      plan.decreased ? "DECREASE" : "",
      plan.negativeRemaining ? "NEGATIVE_REMAINING" : "",
    ]
      .filter(Boolean)
      .join(",");
    console.log(
      String(plan.staffId).padEnd(12) +
        plan.leaveTypeName.slice(0, 15).padEnd(16) +
        plan.oldEntitled.toFixed(2).padStart(10) +
        " →" +
        plan.newEntitled.toFixed(2).padStart(10) +
        plan.oldRemaining.toFixed(2).padStart(10) +
        " →" +
        plan.newRemaining.toFixed(2).padStart(10) +
        plan.daysUsed.toFixed(2).padStart(8) +
        (flags ? `  ${flags}` : ""),
    );
  }

  console.log(
    `\nBalances: ${plans.length} | changing: ${changed.length} | decreases: ${decreases.length} | negative remaining: ${negatives.length}`,
  );

  if (decreases.length || negatives.length) {
    console.log("\nFLAGGED rows requiring --confirm-decreases before --apply:");
    for (const plan of [...decreases, ...negatives]) {
      console.log(
        `  ${plan.staffId} ${plan.leaveTypeName}: entitled ${plan.oldEntitled}→${plan.newEntitled}, remaining ${plan.oldRemaining}→${plan.newRemaining} (used=${plan.daysUsed})`,
      );
    }
  }

  if (!args.apply) {
    console.log(
      "\nDry-run only — no writes. Re-run with --apply to persist entitled_days updates.",
    );
    if (decreases.length || negatives.length) {
      console.log(
        "Also pass --confirm-decreases with --apply to accept decreases/negative remaining.",
      );
    }
    return;
  }

  if ((decreases.length || negatives.length) && !args.confirmDecreases) {
    throw new Error(
      "Refusing --apply: entitlement decreases and/or negative remaining detected. Re-run with --confirm-decreases after review.",
    );
  }

  let updated = 0;
  for (const plan of changed) {
    const { error } = await admin
      .from("employee_leave_balances")
      .update({ entitled_days: plan.newEntitled })
      .eq("id", plan.balance.id)
      .eq("tenant_id", args.tenantId)
      .eq("year", args.year);
    if (error) {
      throw new Error(
        `Update failed for ${plan.staffId}/${plan.leaveTypeName}: ${error.message}`,
      );
    }
    updated += 1;
  }

  console.log(
    `\nApplied entitled_days updates to ${updated} balance rows (days_used untouched; remaining recomputed by DB).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
